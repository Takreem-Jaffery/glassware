import { findEffectiveBackground, compositeOver } from './background';
import { getImageStore, toImagePixels, type ImagePixels, type PixelReader } from './images';
import { measureRegion, readBackgroundStack, rectToBox } from './layers';
import {
    parseColor,
    pickTextModeSticky,
    relativeLuminance,
    textModeForTone,
    type BackgroundTone,
    type RGBA,
    type TextMode,
} from './visual';

export type { ImagePixels, PixelReader } from './images';

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

// Images are scaled down to SAMPLE_SIZE x SAMPLE_SIZE before reading pixels.
// The browser does the averaging while scaling, and 256 pixels is plenty
// to judge overall brightness.
const SAMPLE_SIZE = 16;

// When nothing else can tell us what's behind the element, assume a light
// page (the same assumption findEffectiveBackground makes) and use dark text.
export const DEFAULT_TEXT_MODE: TextMode = 'dark';

// Supplies the pixels behind an element when the page's CSS can't describe
// them: an animated canvas, a video, WebGL. It is given the element's
// rectangle (viewport coordinates, as from getBoundingClientRect) and returns
// either the pixels under it or a single color, or null to say "no idea",
// in which case Glassware measures the CSS background instead.
export type BackgroundSampler = (
    rect: DOMRect
) => RGBA | ImagePixels | null | undefined | Promise<RGBA | ImagePixels | null | undefined>;

export interface SamplingDeps {
    // Reads an image's pixels. Replaces the built-in canvas reader, e.g. to
    // go through your own CORS-enabled proxy. Also injectable for tests.
    readPixels?: PixelReader;
    sampleBackground?: BackgroundSampler;
}

// ---------------------------------------------------------------------------
// Pure averaging helpers
// ---------------------------------------------------------------------------

// Average a list of colors. Translucent colors are flattened over `base`
// first: whatever sits underneath them, which is white unless the caller
// knows better (same default as findEffectiveBackground).
// Returns null for an empty list.
export function averageColors(colors: RGBA[], base: RGBA = WHITE): RGBA | null {
    if (colors.length === 0) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const color of colors) {
        const flat = compositeOver(color, base);
        r += flat.r;
        g += flat.g;
        b += flat.b;
    }
    const n = colors.length;
    return { r: r / n, g: g / n, b: b / n, a: 1 };
}

// Average raw RGBA pixel data (as from canvas getImageData().data).
// Returns null if there isn't at least one whole pixel.
// Transparent pixels show `base` (white unless given).
export function averagePixels(data: ArrayLike<number>, base: RGBA = WHITE): RGBA | null {
    const colors: RGBA[] = [];
    for (let i = 0; i + 3 < data.length; i += 4) {
        colors.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] / 255 });
    }
    return averageColors(colors, base);
}

// ---------------------------------------------------------------------------
// Parsing CSS background-image values
// ---------------------------------------------------------------------------

// Pull the first url(...) out of a background-image value, or null.
export function extractImageUrl(backgroundImage: string): string | null {
    const match = backgroundImage.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    return match && match[2] ? match[2] : null;
}

// Collect the color stops we understand (#hex, rgb(), rgba(), transparent)
// from a gradient. Transparent and translucent stops are kept on purpose:
// they show whatever is underneath, so the caller flattens them over the
// element's own background color.
// Other named colors (e.g. "red") are not recognised yet; a gradient made
// only of them yields no colors and the caller falls back.
export function extractGradientColors(backgroundImage: string): RGBA[] {
    const withoutUrls = backgroundImage.replace(/url\([^)]*\)/gi, '');
    const tokens =
        withoutUrls.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\btransparent\b/gi) ?? [];
    const colors: RGBA[] = [];
    for (const token of tokens) {
        const color = parseColor(token);
        if (color) colors.push(color);
    }
    return colors;
}

// ---------------------------------------------------------------------------
// Canvas reader (browser only)
// ---------------------------------------------------------------------------

// Default PixelReader. Loads the image with CORS enabled and draws it to a
// small canvas. Resolves null on any failure, including the SecurityError
// thrown by getImageData when a cross-origin image taints the canvas.
export function readPixelsFromCanvas(
    url: string,
    timeoutMs = 3000
): Promise<ArrayLike<number> | null> {
    return new Promise((resolve) => {
        if (typeof Image === 'undefined' || typeof document === 'undefined') {
            resolve(null);
            return;
        }
        // A stalled request must not leave the caller waiting forever.
        const timer = setTimeout(() => resolve(null), timeoutMs);
        const finish = (value: ArrayLike<number> | null) => {
            clearTimeout(timer);
            resolve(value);
        };
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = SAMPLE_SIZE;
                canvas.height = SAMPLE_SIZE;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    finish(null);
                    return;
                }
                ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                finish(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
            } catch {
                finish(null); // tainted canvas, etc.
            }
        };
        img.onerror = () => finish(null);
        img.src = url;
    });
}

async function safeRead(reader: PixelReader, url: string): Promise<ArrayLike<number> | ImagePixels | null> {
    try {
        return await reader(url);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Sampling an element that has a background-image
// ---------------------------------------------------------------------------

// Estimate the average color of an element's whole background-image.
//  - url(...) images are drawn to a small canvas and averaged.
//  - If that fails (or there's no url), gradient color stops are averaged.
// Returns null when neither works, so the caller can fall back to
// data-glass-bg / data-glass-mode.
//
// Transparent parts of the image or gradient show the node's own
// background-color, so that color is the base they are flattened over
// (a navy page with a translucent white grid is dark, not light).
//
// This is the rough estimate used when the region under the element can't be
// worked out (no layout, an unsupported background, an unreadable image).
// It averages the whole image: background-size, background-position and the
// exact spot under the glass element are ignored, and only the node's own
// background-color is considered beneath the image, not its ancestors'.
export async function sampleBackground(
    node: Element,
    deps: SamplingDeps = {}
): Promise<RGBA | null> {
    const style = getComputedStyle(node);
    const image = style.backgroundImage;
    if (!image || image === 'none') return null;

    const ownColor = parseColor(style.backgroundColor);
    const base = ownColor && ownColor.a > 0 ? compositeOver(ownColor, WHITE) : WHITE;

    const url = extractImageUrl(image);
    if (url) {
        const read = await safeRead(deps.readPixels ?? readPixelsFromCanvas, url);
        const pixels = toImagePixels(read);
        const average = pixels ? averagePixels(pixels.data, base) : null;
        if (average) return average;
    }

    return averageColors(extractGradientColors(image), base);
}

// ---------------------------------------------------------------------------
// Putting it together: which text color should this element use?
// ---------------------------------------------------------------------------

// data-glass-mode and the contrastMode config describe the BACKGROUND
// ("light" = a light background behind the button), per SPEC §4.
// The returned TextMode describes the TEXT, so the two are inverses.
function readTone(value: string | null | undefined): BackgroundTone | null {
    const v = value?.trim().toLowerCase();
    return v === 'light' || v === 'dark' ? v : null;
}

// What was found behind an element, and how.
export interface BackgroundMeasure {
    luminance: number; // 0 (black) to 1 (white)
    color: RGBA; // the average color, fully opaque
    source:
        | 'custom' // your sampleBackground function
        | 'region' // the CSS background, painted at the spot under the element
        | 'color' // a solid background color (no layout, or nothing to paint)
        | 'image' // the whole background image averaged (rough estimate)
        | 'hint'; // the data-glass-bg attribute
}

function measureOf(color: RGBA, source: BackgroundMeasure['source'], luminance?: number): BackgroundMeasure {
    const flat = color.a < 1 ? compositeOver(color, WHITE) : color;
    return {
        luminance: luminance ?? relativeLuminance(flat.r, flat.g, flat.b),
        color: { r: flat.r, g: flat.g, b: flat.b, a: 1 },
        source,
    };
}

// Mean per-pixel luminance of RGBA data, transparent pixels over white.
function pixelsLuminance(data: ArrayLike<number>): number {
    let total = 0;
    let count = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const flat = compositeOver(
            { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] / 255 },
            WHITE
        );
        total += relativeLuminance(flat.r, flat.g, flat.b);
        count++;
    }
    return count > 0 ? total / count : 0;
}

function isEmptyRect(rect: DOMRect): boolean {
    return !(rect.width > 0 && rect.height > 0);
}

async function measureCustom(el: Element, sampler: BackgroundSampler): Promise<BackgroundMeasure | null> {
    try {
        const result = await sampler(el.getBoundingClientRect());
        if (!result) return null;
        if ('data' in result) {
            const pixels = toImagePixels(result);
            const color = pixels ? averagePixels(pixels.data) : null;
            return pixels && color ? measureOf(color, 'custom', pixelsLuminance(pixels.data)) : null;
        }
        return measureOf(result, 'custom');
    } catch {
        return null; // a broken sampler must not break the button
    }
}

async function measureRegionBehind(el: Element, deps: SamplingDeps): Promise<BackgroundMeasure | null> {
    if (isEmptyRect(el.getBoundingClientRect())) return null; // no layout (jsdom, display: none)

    const first = readBackgroundStack(el);
    if (!first) return null;

    const images = new Map<string, ImagePixels>();
    if (first.urls.length > 0) {
        const store = getImageStore(deps.readPixels);
        for (const url of new Set(first.urls)) {
            const pixels = await store.get(url);
            if (!pixels) return null;
            images.set(url, pixels);
        }
    }

    // Images take time to load, and the element may have moved meanwhile.
    // Measure where it is now, with what the page looks like now.
    const rect = el.getBoundingClientRect();
    const stack = first.urls.length > 0 ? readBackgroundStack(el) : first;
    if (!stack || isEmptyRect(rect)) return null;

    const result = measureRegion({ rect: rectToBox(rect), stack: stack.nodes, images });
    return result ? measureOf(result.color, 'region', result.luminance) : null;
}

// Measure what is behind an element, best source first:
//   1. deps.sampleBackground, if you supplied one
//   2. the CSS background painted at the spot under the element
//   3. the effective background color, or the whole image averaged
//   4. the data-glass-bg attribute
// Returns null when nothing can be measured.
export async function measureBackground(
    el: Element,
    options: { deps?: SamplingDeps } = {}
): Promise<BackgroundMeasure | null> {
    const deps = options.deps ?? {};

    if (deps.sampleBackground) {
        const custom = await measureCustom(el, deps.sampleBackground);
        if (custom) return custom;
    }

    const region = await measureRegionBehind(el, deps);
    if (region) return region;

    const background = findEffectiveBackground(el);
    if (background.kind === 'color') {
        return measureOf(background.color, 'color');
    }
    const averaged = await sampleBackground(background.element, deps);
    if (averaged) return measureOf(averaged, 'image');

    const hint = parseColor(el.getAttribute('data-glass-bg') ?? '');
    return hint ? measureOf(hint, 'hint') : null;
}

export interface ResolveOptions {
    // From the config schema (SPEC §7). 'light'/'dark' declare the background.
    contrastMode?: 'auto' | BackgroundTone;
    // Luminance cutoff for pickTextMode (default 0.5)
    threshold?: number;
    // The text mode currently showing. When given, the text only switches
    // after luminance passes the threshold by a small margin (no flicker).
    previous?: TextMode;
    deps?: SamplingDeps;
}

export interface ContrastResolution {
    mode: TextMode;
    // What was measured. null when the mode was declared (contrastMode,
    // data-glass-mode) or nothing could be measured.
    measurement: BackgroundMeasure | null;
}

// Decide whether the element should use light or dark text.
// Order of precedence:
//   1. contrastMode config set to 'light' / 'dark'
//   2. data-glass-mode attribute ("light" / "dark")
//   3. measured background (see measureBackground)
//   4. DEFAULT_TEXT_MODE
export async function resolveContrast(
    el: Element,
    options: ResolveOptions = {}
): Promise<ContrastResolution> {
    const { contrastMode = 'auto', threshold, previous, deps } = options;

    if (contrastMode !== 'auto') {
        return { mode: textModeForTone(contrastMode), measurement: null };
    }

    const declared = readTone(el.getAttribute('data-glass-mode'));
    if (declared) return { mode: textModeForTone(declared), measurement: null };

    const measurement = await measureBackground(el, { deps });
    if (!measurement) return { mode: DEFAULT_TEXT_MODE, measurement: null };

    return {
        mode: pickTextModeSticky(measurement.luminance, previous, threshold),
        measurement,
    };
}

// Same decision as resolveContrast, returning only the text mode.
export async function resolveContrastMode(
    el: Element,
    options: ResolveOptions = {}
): Promise<TextMode> {
    return (await resolveContrast(el, options)).mode;
}