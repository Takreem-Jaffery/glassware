// Working out the color of the patch of background that sits under an
// element, instead of averaging a whole background image.
//
// A background is a stack of layers (background-image can list several),
// each placed by background-size, -position, -repeat, -origin and
// -attachment, over a background-color. Ancestors stack too. Given an
// element's rectangle, this paints that stack at a grid of points inside
// the rectangle and averages the result.

import { compositeOver } from './background';
import {
    createGradientPainter,
    looseGradientColor,
    parseGradient,
    parseLength,
    parsePositionTokens,
    splitTopLevel,
    type Gradient,
    type Length,
} from './gradient';
import type { ImagePixels } from './images';
import { parseColor, relativeLuminance, type RGBA } from './visual';

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

type SizeValue = 'auto' | Length;

export type LayerImage =
    | { kind: 'url'; url: string }
    | { kind: 'gradient'; gradient: Gradient }
    // A stand-in for a gradient that couldn't be parsed (conic, named colors).
    | { kind: 'color'; color: RGBA };

export interface BackgroundLayer {
    image: LayerImage;
    size: 'cover' | 'contain' | { x: SizeValue; y: SizeValue };
    position: { x: Length; y: Length };
    repeatX: boolean;
    repeatY: boolean;
    attachment: 'scroll' | 'fixed' | 'local';
    origin: 'border-box' | 'padding-box' | 'content-box';
}

// The computed-style strings for one element, one comma-separated list each.
export interface LayerStyle {
    image: string;
    size: string;
    position: string;
    repeat: string;
    attachment: string;
    origin: string;
}

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

// ---------------------------------------------------------------------------
// Parsing a style into layers
// ---------------------------------------------------------------------------

function parseImage(token: string): LayerImage | null {
    const url = token.match(/^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/i);
    if (url) return url[2] ? { kind: 'url', url: url[2] } : null;

    const gradient = parseGradient(token);
    if (gradient) return { kind: 'gradient', gradient };

    if (/-gradient\(/i.test(token)) {
        const color = looseGradientColor(token);
        return color ? { kind: 'color', color } : null;
    }
    return null; // image-set(), element(), cross-fade() and so on
}

function parseSize(value: string): BackgroundLayer['size'] | null {
    const lower = value.trim().toLowerCase();
    if (lower === 'cover' || lower === 'contain') return lower;

    const tokens = splitTopLevel(lower, 'space');
    if (tokens.length < 1 || tokens.length > 2) return null;

    const component = (token: string): SizeValue | null => (token === 'auto' ? 'auto' : parseLength(token));
    const x = component(tokens[0]);
    const y = tokens.length === 2 ? component(tokens[1]) : 'auto';
    return x && y ? { x, y } : null;
}

function parseRepeat(value: string): { x: boolean; y: boolean } | null {
    const tokens = splitTopLevel(value.toLowerCase(), 'space');
    const repeats = (token: string) => token === 'repeat' || token === 'space' || token === 'round';
    const known = (token: string) => repeats(token) || token === 'no-repeat';

    if (tokens.length === 1) {
        if (tokens[0] === 'repeat-x') return { x: true, y: false };
        if (tokens[0] === 'repeat-y') return { x: false, y: true };
        return known(tokens[0]) ? { x: repeats(tokens[0]), y: repeats(tokens[0]) } : null;
    }
    if (tokens.length === 2 && known(tokens[0]) && known(tokens[1])) {
        return { x: repeats(tokens[0]), y: repeats(tokens[1]) };
    }
    return null;
}

// Turn computed style strings into a list of layers, topmost first.
// Returns null if any layer uses something unsupported, so the caller can
// fall back to a rougher estimate instead of guessing.
export function parseBackgroundLayers(style: LayerStyle): BackgroundLayer[] | null {
    const images = splitTopLevel(style.image, ',');
    const sizes = splitTopLevel(style.size, ',');
    const positions = splitTopLevel(style.position, ',');
    const repeats = splitTopLevel(style.repeat, ',');
    const attachments = splitTopLevel(style.attachment, ',');
    const origins = splitTopLevel(style.origin, ',');

    // Shorter lists repeat to match the number of images.
    const pick = (list: string[], index: number, fallback: string) =>
        list.length > 0 ? list[index % list.length] : fallback;

    const layers: BackgroundLayer[] = [];
    for (let i = 0; i < images.length; i++) {
        if (images[i].toLowerCase() === 'none') continue;

        const image = parseImage(images[i]);
        const size = parseSize(pick(sizes, i, 'auto'));
        const position = parsePositionTokens(splitTopLevel(pick(positions, i, '0% 0%'), 'space'));
        const repeat = parseRepeat(pick(repeats, i, 'repeat'));
        if (!image || !size || !position || !repeat) return null;

        const attachment = pick(attachments, i, 'scroll').toLowerCase();
        const origin = pick(origins, i, 'padding-box').toLowerCase();
        layers.push({
            image,
            size,
            position,
            repeatX: repeat.x,
            repeatY: repeat.y,
            attachment: attachment === 'fixed' || attachment === 'local' ? attachment : 'scroll',
            origin: origin === 'border-box' || origin === 'content-box' ? origin : 'padding-box',
        });
    }
    return layers;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Edges {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface NodeGeometry {
    border: Box; // the border box, in viewport coordinates
    borderWidths: Edges;
    padding: Edges;
    viewport: Box; // what background-attachment: fixed is placed against
    scroll: { left: number; top: number; width: number; height: number }; // for attachment: local
}

function inset(box: Box, edges: Edges): Box {
    return {
        x: box.x + edges.left,
        y: box.y + edges.top,
        w: box.w - edges.left - edges.right,
        h: box.h - edges.top - edges.bottom,
    };
}

// The box a layer is positioned against (its "positioning area").
export function originBox(layer: BackgroundLayer, geometry: NodeGeometry): Box {
    if (layer.attachment === 'fixed') return geometry.viewport;

    const paddingBox = inset(geometry.border, geometry.borderWidths);
    if (layer.attachment === 'local' && layer.origin === 'padding-box') {
        return {
            x: paddingBox.x - geometry.scroll.left,
            y: paddingBox.y - geometry.scroll.top,
            w: Math.max(geometry.scroll.width, paddingBox.w),
            h: Math.max(geometry.scroll.height, paddingBox.h),
        };
    }
    if (layer.origin === 'border-box') return geometry.border;
    if (layer.origin === 'content-box') return inset(paddingBox, geometry.padding);
    return paddingBox;
}

// The size of one tile of a layer. `intrinsic` is the image's own size, or
// null for a gradient, which has none and so fills the box when its size is auto.
export function tileSize(
    size: BackgroundLayer['size'],
    intrinsic: { w: number; h: number } | null,
    box: Box
): { w: number; h: number } {
    const known = intrinsic && intrinsic.w > 0 && intrinsic.h > 0 ? intrinsic : null;

    if (size === 'cover' || size === 'contain') {
        if (!known) return { w: box.w, h: box.h };
        const scaleX = box.w / known.w;
        const scaleY = box.h / known.h;
        const scale = size === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
        return { w: known.w * scale, h: known.h * scale };
    }

    const resolve = (value: SizeValue, total: number): number | null =>
        value === 'auto' ? null : value.unit === '%' ? (total * value.value) / 100 : value.value;

    let w = resolve(size.x, box.w);
    let h = resolve(size.y, box.h);

    if (w === null && h === null) return known ? { w: known.w, h: known.h } : { w: box.w, h: box.h };
    if (w === null) w = known ? ((h as number) * known.w) / known.h : box.w;
    else if (h === null) h = known ? (w * known.h) / known.w : box.h;
    return { w: w as number, h: h as number };
}

// Where the first tile starts. A percentage position lines up that fraction
// of the tile with the same fraction of the box.
export function tileOrigin(
    position: BackgroundLayer['position'],
    tile: { w: number; h: number },
    box: Box
): { x: number; y: number } {
    const place = (length: Length, free: number, start: number) =>
        start + (length.unit === '%' ? (free * length.value) / 100 : length.value);
    return {
        x: place(position.x, box.w - tile.w, box.x),
        y: place(position.y, box.h - tile.h, box.y),
    };
}

// ---------------------------------------------------------------------------
// Painting layers
// ---------------------------------------------------------------------------

type PointPainter = (x: number, y: number) => RGBA;

const mod = (value: number, period: number) => ((value % period) + period) % period;

// A function giving a layer's color at a viewport point. `pixels` must be
// supplied for url layers. Returns null when a url layer has no pixels.
export function createLayerPainter(
    layer: BackgroundLayer,
    geometry: NodeGeometry,
    pixels: ImagePixels | null
): PointPainter | null {
    if (layer.image.kind === 'color') {
        const color = layer.image.color;
        return () => color;
    }

    const box = originBox(layer, geometry);

    if (layer.image.kind === 'url' && !pixels) return null;
    const intrinsic = pixels
        ? { w: pixels.naturalWidth ?? pixels.width, h: pixels.naturalHeight ?? pixels.height }
        : null;

    const tile = tileSize(layer.size, intrinsic, box);
    if (!(tile.w > 0 && tile.h > 0)) return () => TRANSPARENT;
    const origin = tileOrigin(layer.position, tile, box);

    const gradientPainter =
        layer.image.kind === 'gradient' ? createGradientPainter(layer.image.gradient, tile.w, tile.h) : null;

    return (x, y) => {
        let u = x - origin.x;
        let v = y - origin.y;

        if (layer.repeatX) u = mod(u, tile.w);
        else if (u < 0 || u >= tile.w) return TRANSPARENT;
        if (layer.repeatY) v = mod(v, tile.h);
        else if (v < 0 || v >= tile.h) return TRANSPARENT;

        if (gradientPainter) return gradientPainter(u, v);

        const image = pixels as ImagePixels;
        const px = Math.min(image.width - 1, Math.floor((u / tile.w) * image.width));
        const py = Math.min(image.height - 1, Math.floor((v / tile.h) * image.height));
        const index = (py * image.width + px) * 4;
        return {
            r: image.data[index],
            g: image.data[index + 1],
            b: image.data[index + 2],
            a: image.data[index + 3] / 255,
        };
    };
}

// ---------------------------------------------------------------------------
// Measuring a region
// ---------------------------------------------------------------------------

export interface BackgroundNode {
    box: Box; // the border box; empty when the page has no layout (jsdom, display: none)
    color: RGBA | null; // background-color, when it shows
    layers: BackgroundLayer[]; // topmost first
    geometry: NodeGeometry;
}

export interface RegionInput {
    rect: Box; // the element's rectangle, in viewport coordinates
    stack: BackgroundNode[]; // nearest ancestor first
    images: Map<string, ImagePixels>; // decoded pixels for every url layer
}

export interface RegionResult {
    color: RGBA; // average color of the region, fully opaque
    luminance: number; // average relative luminance, 0 to 1
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function contains(box: Box, x: number, y: number): boolean {
    return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
}

// Paint the stack at a grid of points inside `rect` and average the result.
// Returns null when it can't be done: the rectangle is empty, a node with
// background images has no layout, or an image's pixels are missing. The
// caller then falls back to a rougher estimate.
export function measureRegion(input: RegionInput): RegionResult | null {
    const { rect, stack, images } = input;
    if (!(rect.w > 0 && rect.h > 0)) return null;

    // Outermost first, so each node paints over the one behind it.
    const painters = [];
    for (let i = stack.length - 1; i >= 0; i--) {
        const node = stack[i];
        const hasLayout = node.box.w > 0 && node.box.h > 0;
        if (node.layers.length > 0 && !hasLayout) return null;

        // The layer list is topmost first; paint bottom to top.
        const layerPainters: PointPainter[] = [];
        for (let j = node.layers.length - 1; j >= 0; j--) {
            const layer = node.layers[j];
            const pixels = layer.image.kind === 'url' ? (images.get(layer.image.url) ?? null) : null;
            const painter = createLayerPainter(layer, node.geometry, pixels);
            if (!painter) return null;
            layerPainters.push(painter);
        }
        painters.push({ node, hasLayout, layerPainters });
    }

    const columns = clamp(Math.ceil(rect.w / 10), 3, 16);
    const rows = clamp(Math.ceil(rect.h / 10), 3, 16);

    let red = 0;
    let green = 0;
    let blue = 0;
    let luminance = 0;

    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const x = rect.x + ((column + 0.5) / columns) * rect.w;
            const y = rect.y + ((row + 0.5) / rows) * rect.h;

            let color = WHITE; // the page itself, behind everything
            for (const { node, hasLayout, layerPainters } of painters) {
                if (hasLayout && !contains(node.box, x, y)) continue; // not painted here
                if (node.color) color = compositeOver(node.color, color);
                for (const painter of layerPainters) color = compositeOver(painter(x, y), color);
            }

            red += color.r;
            green += color.g;
            blue += color.b;
            luminance += relativeLuminance(color.r, color.g, color.b);
        }
    }

    const count = columns * rows;
    return {
        color: { r: red / count, g: green / count, b: blue / count, a: 1 },
        luminance: luminance / count,
    };
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

export function rectToBox(rect: { left: number; top: number; width: number; height: number }): Box {
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function edges(style: CSSStyleDeclaration, prefix: 'border' | 'padding', suffix: '' | 'Width'): Edges {
    const read = (side: string) => parseFloat(style.getPropertyValue(`${prefix}-${side}${suffix ? '-width' : ''}`)) || 0;
    return { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') };
}

// Collect everything that paints behind an element: its ancestors that have
// a background color or image, nearest first, stopping at the first fully
// opaque color (nothing behind it shows). Also lists the image urls that
// need loading. Returns null when a background uses something unsupported.
export function readBackgroundStack(el: Element): { nodes: BackgroundNode[]; urls: string[] } | null {
    const view = el.ownerDocument.defaultView;
    if (!view) return null;

    const nodes: BackgroundNode[] = [];
    const urls: string[] = [];

    for (let node = el.parentElement; node; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const parsed = parseColor(style.backgroundColor);
        const color = parsed && parsed.a > 0 ? parsed : null;
        const hasImage = style.backgroundImage !== '' && style.backgroundImage !== 'none';
        if (!color && !hasImage) continue;

        let layers: BackgroundLayer[] = [];
        if (hasImage) {
            const parsedLayers = parseBackgroundLayers({
                image: style.backgroundImage,
                size: style.backgroundSize,
                position: style.backgroundPosition,
                repeat: style.backgroundRepeat,
                attachment: style.backgroundAttachment,
                origin: style.backgroundOrigin,
            });
            if (!parsedLayers) return null;
            layers = parsedLayers;
            for (const layer of layers) if (layer.image.kind === 'url') urls.push(layer.image.url);
        }

        const border = rectToBox(node.getBoundingClientRect());
        nodes.push({
            box: border,
            color,
            layers,
            geometry: {
                border,
                borderWidths: edges(style, 'border', 'Width'),
                padding: edges(style, 'padding', ''),
                viewport: { x: 0, y: 0, w: view.innerWidth, h: view.innerHeight },
                scroll: {
                    left: node.scrollLeft,
                    top: node.scrollTop,
                    width: node.scrollWidth,
                    height: node.scrollHeight,
                },
            },
        });

        if (color && color.a >= 1) break;
    }

    return { nodes, urls };
}