import { findEffectiveBackground, compositeOver } from "./background";
import { parseColor, pickTextMode, relativeLuminance, type ContrastMode, type RGBA } from "./visual";

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1};

// Images scaled down to SampleSize x SampleSize before reading pixels
// browser does averaging while scaling
const SAMPLE_SIZE = 16;

// If we can't tell what is behind the element, assume it's a light page
// and use dark text (same assumption as findEffectiveBackground)
export const DEFAULT_TEXT_MODE: ContrastMode = 'dark';

// Read raw RGBA pixel data for an image URL.
// Return null if the image can't be read
export type PixelReader = (url: string) => Promise<ArrayLike<number> | null>;

export interface SamplingDeps { readPixels?: PixelReader; }


// Pure averaging helpers

// Avg list of colors. Translucent colors are flattened over white first.
// Returns null for an empty list.
export function averageColors(colors: RGBA[]): RGBA | null {
    if (colors.length === 0) return null;

    let r = 0;
    let g = 0;
    let b = 0;
    for (const color of colors) {
        const flat = compositeOver(color, WHITE);
        r += flat.r;
        g += flat.g;
        b += flat.b;
    }
    const n = colors.length;
    return { r: r/n, g: g/n, b: b/n, a: 1};
}

// Average raw RGBA pixel data (from canvas getImageData().data)
// Returns null if there isn't at least one whole pixel
export function averagePixels(data: ArrayLike<number>): RGBA | null {
    const colors: RGBA[] = [];
    for (let i = 0; i + 3 < data.length; i += 4){
        colors.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3]/255});

    }
    return averageColors(colors);
}


// Parsing CSS background-image values

// Pull the first url(...) out of a background-image value or null
export function extractImageUrl(backgroundImage: string): string | null {
    const match = backgroundImage.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    return match && match[2] ? match[2] : null;
}

// Collect the color stops from a gradient (#hex, rgb(), rgba())
// Fully transparent stops are skipped
// Named colors (e.g. "red") are not recognised yet; a gradient made only of
// them yields no colors and the caller falls back
export function extractGradientColors(backgroundImage: string): RGBA[] {
    const withoutUrls = backgroundImage.replace(/url\([^)]*\)/gi, '');
    const tokens = withoutUrls.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
    const colors: RGBA[] = [];
    for (const token of tokens) {
        const color = parseColor(token);
        if (color && color.a > 0) colors.push(color);
    }
    return colors;
}


// Canvas reader (browser only)

// Default PixelReader. Loads the image with CORS enables and draws it to
// a small canvas. Resolved null on any failure
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
 
async function safeRead(reader: PixelReader, url: string): Promise<ArrayLike<number> | null> {
    try {
        return await reader(url);
    } catch {
        return null;
    }
}


// Sampling an element that has a background image

// Estimate the average color of the background image
//  - url(...) images are drawn to a small canvas and averaged.
//  - If that fails (or there's no url), gradient color stops are averaged.
// Returns null when neither works so we fall back to data-glass-bg / data-glass-mode
//
// Known limitation (v1): the whole image is averaged. background-size,
// background-position and the exact spot under the glass element are ignored.
export async function sampleBackground(
    node: Element,
    deps: SamplingDeps = {}
): Promise<RGBA | null> {
    const image = getComputedStyle(node).backgroundImage;
    if (!image || image === 'none') return null;
 
    const url = extractImageUrl(image);
    if (url) {
        const pixels = await safeRead(deps.readPixels ?? readPixelsFromCanvas, url);
        const average = pixels ? averagePixels(pixels) : null;
        if (average) return average;
    }
 
    return averageColors(extractGradientColors(image));
}


// Putting it together: which text color should this element use?

// data-glass-mode and the contrastMode config describe the BACKGROUND
// ("light" = a light background behind the button), per SPEC §4.
// The returned ContrastMode describes the TEXT, as pickTextMode does,
// so the two are inverses of each other.
type BackgroundTone = 'light' | 'dark';
 
function textModeForTone(tone: BackgroundTone): ContrastMode {
    return tone === 'light' ? 'dark' : 'light';
}
 
function readTone(value: string | null | undefined): BackgroundTone | null {
    const v = value?.trim().toLowerCase();
    return v === 'light' || v === 'dark' ? v : null;
}
 
export interface ResolveOptions {
    // From the config schema (SPEC §7). 'light'/'dark' declare the background.
    contrastMode?: 'auto' | 'light' | 'dark';
    // Luminance cutoff for pickTextMode (default 0.5)
    threshold?: number;
    deps?: SamplingDeps;
}

// Decide whether the elemnt should use light or dark text
// Order of precedence:
//   1. contrastMode config set to 'light' / 'dark'
//   2. data-glass-mode attribute ("light" / "dark")
//   3. measured background: solid color, or sampled image/gradient
//   4. data-glass-bg attribute (a CSS color) when sampling isn't possible
//   5. DEFAULT_TEXT_MODE
export async function resolveContrastMode(
    el: Element,
    options: ResolveOptions = {}
): Promise<ContrastMode> {
    const { contrastMode = 'auto', threshold, deps } = options;
 
    if (contrastMode !== 'auto') return textModeForTone(contrastMode);
 
    const declared = readTone(el.getAttribute('data-glass-mode'));
    if (declared) return textModeForTone(declared);
 
    const background = findEffectiveBackground(el);
    let color: RGBA | null =
        background.kind === 'color'
            ? background.color
            : await sampleBackground(background.element, deps);
 
    if (!color) {
        const hint = parseColor(el.getAttribute('data-glass-bg') ?? '');
        if (hint) color = compositeOver(hint, WHITE);
    }
 
    if (!color) return DEFAULT_TEXT_MODE;
 
    return pickTextMode(relativeLuminance(color.r, color.g, color.b), threshold);
}