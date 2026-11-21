// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    createLayerPainter,
    measureRegion,
    originBox,
    parseBackgroundLayers,
    readBackgroundStack,
    tileOrigin,
    tileSize,
    type BackgroundLayer,
    type BackgroundNode,
    type Box,
    type LayerStyle,
    type NodeGeometry,
} from '../src/layers';
import { parseGradient } from '../src/gradient';
import type { ImagePixels } from '../src/images';
import type { RGBA } from '../src/visual';

const pct = (value: number) => ({ value, unit: '%' as const });
const px = (value: number) => ({ value, unit: 'px' as const });

function style(overrides: Partial<LayerStyle> = {}): LayerStyle {
    return {
        image: 'none',
        size: 'auto',
        position: '0% 0%',
        repeat: 'repeat',
        attachment: 'scroll',
        origin: 'padding-box',
        ...overrides,
    };
}

function geometryFor(box: Box, extra: Partial<NodeGeometry> = {}): NodeGeometry {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    return {
        border: box,
        borderWidths: none,
        padding: none,
        viewport: { x: 0, y: 0, w: 1000, h: 800 },
        scroll: { left: 0, top: 0, width: box.w, height: box.h },
        ...extra,
    };
}

function layerOf(overrides: Partial<BackgroundLayer>): BackgroundLayer {
    return {
        image: { kind: 'color', color: { r: 0, g: 0, b: 0, a: 1 } },
        size: { x: 'auto', y: 'auto' },
        position: { x: pct(0), y: pct(0) },
        repeatX: true,
        repeatY: true,
        attachment: 'scroll',
        origin: 'padding-box',
        ...overrides,
    };
}

function gradientLayer(css: string, overrides: Partial<BackgroundLayer> = {}): BackgroundLayer {
    const gradient = parseGradient(css);
    if (!gradient) throw new Error(`bad gradient ${css}`);
    return layerOf({ image: { kind: 'gradient', gradient }, ...overrides });
}

// Two-pixel image: black on the left, white on the right.
function blackWhite(naturalWidth = 200, naturalHeight = 100): ImagePixels {
    return { width: 2, height: 1, data: [0, 0, 0, 255, 255, 255, 255, 255], naturalWidth, naturalHeight };
}

function nodeOf(box: Box, parts: Partial<BackgroundNode> = {}): BackgroundNode {
    return { box, color: null, layers: [], geometry: geometryFor(box), ...parts };
}

function near(color: RGBA, r: number, tolerance = 1) {
    expect(Math.abs(color.r - r)).toBeLessThanOrEqual(tolerance);
}

describe('parseBackgroundLayers', () => {
    it('parses a url layer with the CSS defaults', () => {
        const layers = parseBackgroundLayers(style({ image: 'url("photo.png")' }));
        expect(layers).toEqual([
            {
                image: { kind: 'url', url: 'photo.png' },
                size: { x: 'auto', y: 'auto' },
                position: { x: pct(0), y: pct(0) },
                repeatX: true,
                repeatY: true,
                attachment: 'scroll',
                origin: 'padding-box',
            },
        ]);
    });

    it('returns no layers for "none"', () => {
        expect(parseBackgroundLayers(style({ image: 'none' }))).toEqual([]);
    });

    it('keeps the topmost-first order and parses each layer separately', () => {
        const layers = parseBackgroundLayers(
            style({
                image: 'linear-gradient(90deg, #000, #fff), url(a.png)',
                size: 'cover, 10px 20px',
                position: '10px 20px, center center',
                repeat: 'no-repeat, repeat-x',
            })
        ) as BackgroundLayer[];
        expect(layers).toHaveLength(2);
        expect(layers[0].image.kind).toBe('gradient');
        expect(layers[0].size).toBe('cover');
        expect(layers[0].position).toEqual({ x: px(10), y: px(20) });
        expect(layers[0].repeatX).toBe(false);
        expect(layers[1].image).toEqual({ kind: 'url', url: 'a.png' });
        expect(layers[1].size).toEqual({ x: px(10), y: px(20) });
        expect(layers[1].position).toEqual({ x: pct(50), y: pct(50) });
        expect(layers[1].repeatX).toBe(true);
        expect(layers[1].repeatY).toBe(false);
    });

    it('repeats short lists to match the number of images', () => {
        const layers = parseBackgroundLayers(
            style({ image: 'url(a.png), url(b.png), url(c.png)', size: 'cover', repeat: 'no-repeat, repeat' })
        ) as BackgroundLayer[];
        expect(layers.map((l) => l.size)).toEqual(['cover', 'cover', 'cover']);
        expect(layers.map((l) => l.repeatX)).toEqual([false, true, false]);
    });

    it('skips "none" entries inside a list without shifting the others', () => {
        const layers = parseBackgroundLayers(
            style({ image: 'none, url(b.png)', size: '10px 10px, 20px 20px' })
        ) as BackgroundLayer[];
        expect(layers).toHaveLength(1);
        expect(layers[0].size).toEqual({ x: px(20), y: px(20) });
    });

    it('understands repeat shorthands and two-value repeats', () => {
        const repeatOf = (repeat: string) => {
            const [layer] = parseBackgroundLayers(style({ image: 'url(a.png)', repeat })) as BackgroundLayer[];
            return [layer.repeatX, layer.repeatY];
        };
        expect(repeatOf('repeat-x')).toEqual([true, false]);
        expect(repeatOf('repeat-y')).toEqual([false, true]);
        expect(repeatOf('no-repeat')).toEqual([false, false]);
        expect(repeatOf('repeat no-repeat')).toEqual([true, false]);
        expect(repeatOf('space round')).toEqual([true, true]);
    });

    it('reads attachment and origin', () => {
        const [layer] = parseBackgroundLayers(
            style({ image: 'url(a.png)', attachment: 'fixed', origin: 'content-box' })
        ) as BackgroundLayer[];
        expect(layer.attachment).toBe('fixed');
        expect(layer.origin).toBe('content-box');
    });

    it('keeps commas and parentheses inside a quoted url together', () => {
        const layers = parseBackgroundLayers(style({ image: 'url("data:image/svg+xml,<svg a=\'(1,2)\'/>")' }));
        expect(layers).toHaveLength(1);
    });

    it('stands in a color for a gradient it cannot parse', () => {
        const [layer] = parseBackgroundLayers(
            style({ image: 'conic-gradient(rgb(255, 0, 0), rgb(0, 0, 255))' })
        ) as BackgroundLayer[];
        expect(layer.image.kind).toBe('color');
    });

    it('returns null for unsupported layers', () => {
        expect(parseBackgroundLayers(style({ image: 'image-set(url(a.png) 1x)' }))).toBeNull();
        expect(parseBackgroundLayers(style({ image: 'conic-gradient(red, blue)' }))).toBeNull();
        expect(parseBackgroundLayers(style({ image: 'url(a.png)', size: '2em' }))).toBeNull();
        expect(parseBackgroundLayers(style({ image: 'url(a.png)', position: 'right 10px bottom 20px' }))).toBeNull();
        expect(parseBackgroundLayers(style({ image: 'url(a.png)', repeat: 'sideways' }))).toBeNull();
    });
});

describe('tileSize', () => {
    const intrinsic = { w: 200, h: 100 };
    const box: Box = { x: 0, y: 0, w: 100, h: 100 };

    it('cover scales until the box is filled', () => {
        expect(tileSize('cover', intrinsic, box)).toEqual({ w: 200, h: 100 });
    });

    it('contain scales until the image fits', () => {
        expect(tileSize('contain', intrinsic, box)).toEqual({ w: 100, h: 50 });
    });

    it('uses the image size for auto auto, and the box for a gradient', () => {
        expect(tileSize({ x: 'auto', y: 'auto' }, intrinsic, box)).toEqual(intrinsic);
        expect(tileSize({ x: 'auto', y: 'auto' }, null, box)).toEqual({ w: 100, h: 100 });
        expect(tileSize('cover', null, box)).toEqual({ w: 100, h: 100 });
    });

    it('keeps the aspect ratio when one side is auto', () => {
        expect(tileSize({ x: px(50), y: 'auto' }, intrinsic, box)).toEqual({ w: 50, h: 25 });
        expect(tileSize({ x: 'auto', y: px(40) }, intrinsic, box)).toEqual({ w: 80, h: 40 });
        expect(tileSize({ x: pct(50), y: 'auto' }, intrinsic, { x: 0, y: 0, w: 400, h: 300 })).toEqual({
            w: 200,
            h: 100,
        });
    });

    it('fills the other side of a gradient when one side is auto', () => {
        expect(tileSize({ x: px(30), y: 'auto' }, null, box)).toEqual({ w: 30, h: 100 });
    });

    it('uses both sizes when both are given', () => {
        expect(tileSize({ x: px(10), y: px(20) }, intrinsic, box)).toEqual({ w: 10, h: 20 });
        expect(tileSize({ x: pct(50), y: pct(25) }, intrinsic, box)).toEqual({ w: 50, h: 25 });
    });
});

describe('tileOrigin', () => {
    const box: Box = { x: 100, y: 50, w: 300, h: 200 };

    it('lines up a percentage of the tile with the same percentage of the box', () => {
        expect(tileOrigin({ x: pct(0), y: pct(0) }, { w: 100, h: 100 }, box)).toEqual({ x: 100, y: 50 });
        expect(tileOrigin({ x: pct(100), y: pct(100) }, { w: 100, h: 100 }, box)).toEqual({ x: 300, y: 150 });
        expect(tileOrigin({ x: pct(50), y: pct(50) }, { w: 100, h: 100 }, box)).toEqual({ x: 200, y: 100 });
    });

    it('moves by px from the top left of the box', () => {
        expect(tileOrigin({ x: px(10), y: px(-5) }, { w: 100, h: 100 }, box)).toEqual({ x: 110, y: 45 });
    });

    it('lets an oversized tile start outside the box', () => {
        expect(tileOrigin({ x: pct(50), y: pct(50) }, { w: 500, h: 400 }, box)).toEqual({ x: 0, y: -50 });
    });
});

describe('originBox', () => {
    const border: Box = { x: 10, y: 20, w: 200, h: 100 };
    const geometry = geometryFor(border, {
        borderWidths: { top: 2, right: 2, bottom: 2, left: 2 },
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        scroll: { left: 30, top: 40, width: 500, height: 600 },
    });

    it('defaults to the padding box', () => {
        expect(originBox(layerOf({}), geometry)).toEqual({ x: 12, y: 22, w: 196, h: 96 });
    });

    it('supports border-box and content-box', () => {
        expect(originBox(layerOf({ origin: 'border-box' }), geometry)).toEqual(border);
        expect(originBox(layerOf({ origin: 'content-box' }), geometry)).toEqual({ x: 17, y: 27, w: 186, h: 86 });
    });

    it('is the viewport for fixed attachment', () => {
        expect(originBox(layerOf({ attachment: 'fixed' }), geometry)).toEqual(geometry.viewport);
    });

    it('follows the scrolled content for local attachment', () => {
        expect(originBox(layerOf({ attachment: 'local' }), geometry)).toEqual({ x: -18, y: -18, w: 500, h: 600 });
    });
});

describe('createLayerPainter: images', () => {
    const geometry = geometryFor({ x: 0, y: 0, w: 100, h: 100 });

    it('stretches an image to a given size and leaves the rest empty without repeat', () => {
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: { x: px(100), y: px(50) },
                repeatX: false,
                repeatY: false,
            }),
            geometry,
            blackWhite()
        )!;
        near(paint(10, 10), 0);
        near(paint(60, 10), 255);
        expect(paint(60, 80).a).toBe(0);
    });

    it('cover with a centered position crops equally on both sides', () => {
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: 'cover',
                position: { x: pct(50), y: pct(50) },
                repeatX: false,
                repeatY: false,
            }),
            geometry,
            blackWhite(200, 100)
        )!;
        // The image is 200 wide in a 100 wide box, centered: the left half of
        // the box shows the image's left half-of-visible-part (black).
        near(paint(40, 50), 0);
        near(paint(60, 50), 255);
    });

    it('cover with a left position shows the left of the image', () => {
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: 'cover',
                position: { x: pct(0), y: pct(50) },
                repeatX: false,
                repeatY: false,
            }),
            geometry,
            blackWhite(200, 100)
        )!;
        near(paint(10, 50), 0);
        near(paint(90, 50), 0); // still inside the black left half (0..100 of 200)
    });

    it('contain leaves room around a wide image', () => {
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: 'contain',
                position: { x: pct(50), y: pct(50) },
                repeatX: false,
                repeatY: false,
            }),
            geometry,
            blackWhite(200, 100)
        )!;
        expect(paint(50, 5).a).toBe(0); // above the 100x50 image
        near(paint(25, 50), 0);
        near(paint(75, 50), 255);
    });

    it('repeats a tile along x only for repeat-x', () => {
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: { x: px(20), y: px(10) },
                repeatX: true,
                repeatY: false,
            }),
            geometry,
            blackWhite()
        )!;
        near(paint(5, 5), 0);
        near(paint(15, 5), 255);
        near(paint(25, 5), 0);
        near(paint(35, 5), 255);
        expect(paint(5, 15).a).toBe(0);
    });

    it('reads the alpha channel of the image', () => {
        const paint = createLayerPainter(
            layerOf({ image: { kind: 'url', url: 'a.png' }, size: 'cover' }),
            geometry,
            { width: 1, height: 1, data: [10, 20, 30, 51] }
        )!;
        expect(paint(50, 50)).toEqual({ r: 10, g: 20, b: 30, a: 0.2 });
    });

    it('returns null when a url layer has no pixels', () => {
        expect(createLayerPainter(layerOf({ image: { kind: 'url', url: 'a.png' } }), geometry, null)).toBeNull();
    });

    it('places a fixed layer against the viewport, not the element', () => {
        const small = geometryFor({ x: 500, y: 400, w: 100, h: 100 }); // viewport is 1000 x 800
        const paint = createLayerPainter(
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: 'cover',
                attachment: 'fixed',
                repeatX: false,
                repeatY: false,
            }),
            small,
            blackWhite(200, 100)
        )!;
        near(paint(100, 400), 0); // left half of the viewport
        near(paint(900, 400), 255); // right half
    });
});

describe('createLayerPainter: gradients and colors', () => {
    const geometry = geometryFor({ x: 100, y: 100, w: 200, h: 100 });

    it('fills the box with a gradient by default, offset by the box position', () => {
        const paint = createLayerPainter(gradientLayer('linear-gradient(90deg, #000000, #ffffff)'), geometry, null)!;
        near(paint(100, 150), 0);
        near(paint(200, 150), 127.5);
        near(paint(299, 150), 254);
    });

    it('repeats a small gradient tile, each tile starting over', () => {
        const paint = createLayerPainter(
            gradientLayer('linear-gradient(90deg, #000000, #ffffff)', { size: { x: px(50), y: px(50) } }),
            geometry,
            null
        )!;
        near(paint(100, 110), 0);
        near(paint(125, 110), 127.5);
        near(paint(150, 110), 0); // second tile starts over
    });

    it('paints one flat color for a stand-in color layer', () => {
        const paint = createLayerPainter(
            layerOf({ image: { kind: 'color', color: { r: 9, g: 8, b: 7, a: 1 } } }),
            geometry,
            null
        )!;
        expect(paint(0, 0)).toEqual({ r: 9, g: 8, b: 7, a: 1 });
    });

    it('does not throw for an empty tile', () => {
        const paint = createLayerPainter(
            gradientLayer('linear-gradient(90deg, #000000, #ffffff)', { size: { x: px(0), y: px(0) } }),
            geometry,
            null
        )!;
        expect(paint(120, 120).a).toBe(0);
    });
});

describe('measureRegion', () => {
    const stage: Box = { x: 0, y: 0, w: 200, h: 100 };

    it('returns null for an empty rectangle', () => {
        expect(measureRegion({ rect: { x: 0, y: 0, w: 0, h: 10 }, stack: [], images: new Map() })).toBeNull();
    });

    it('is white on a page with nothing painted', () => {
        const result = measureRegion({ rect: { x: 0, y: 0, w: 50, h: 20 }, stack: [], images: new Map() })!;
        expect(result.color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(result.luminance).toBeCloseTo(1, 5);
    });

    it('measures a solid color', () => {
        const result = measureRegion({
            rect: { x: 10, y: 10, w: 40, h: 20 },
            stack: [nodeOf(stage, { color: { r: 20, g: 40, b: 60, a: 1 } })],
            images: new Map(),
        })!;
        expect(result.color).toEqual({ r: 20, g: 40, b: 60, a: 1 });
    });

    it('only counts the part of the region the node actually covers', () => {
        const result = measureRegion({
            rect: { x: 0, y: 0, w: 100, h: 50 },
            stack: [nodeOf({ x: 0, y: 0, w: 50, h: 50 }, { color: { r: 0, g: 0, b: 0, a: 1 } })],
            images: new Map(),
        })!;
        // Left half black, right half the white page behind it.
        expect(result.luminance).toBeCloseTo(0.5, 2);
    });

    it('treats a color on a node with no layout as covering everything', () => {
        const result = measureRegion({
            rect: { x: 0, y: 0, w: 50, h: 50 },
            stack: [nodeOf({ x: 0, y: 0, w: 0, h: 0 }, { color: { r: 0, g: 0, b: 0, a: 1 } })],
            images: new Map(),
        })!;
        expect(result.luminance).toBeCloseTo(0, 5);
    });

    it('measures the patch of a gradient under the region, not the whole gradient', () => {
        const stack = [nodeOf(stage, { layers: [gradientLayer('linear-gradient(90deg, #000000, #ffffff)')] })];
        const at = (x: number) =>
            measureRegion({ rect: { x, y: 40, w: 20, h: 20 }, stack, images: new Map() })!;
        const left = at(0);
        const middle = at(90);
        const right = at(180);
        near(left.color, 12.75, 1.5);
        near(middle.color, 127.5, 1.5);
        near(right.color, 242, 1.5);
        expect(left.luminance).toBeLessThan(middle.luminance);
        expect(middle.luminance).toBeLessThan(right.luminance);
    });

    it('measures the patch of an image', () => {
        const layers = [
            layerOf({
                image: { kind: 'url', url: 'a.png' },
                size: 'cover',
                position: { x: pct(0), y: pct(0) },
                repeatX: false,
                repeatY: false,
            }),
        ];
        const stack = [nodeOf(stage, { layers })];
        const images = new Map([['a.png', blackWhite(200, 100)]]);
        const left = measureRegion({ rect: { x: 10, y: 10, w: 30, h: 30 }, stack, images })!;
        const right = measureRegion({ rect: { x: 150, y: 10, w: 30, h: 30 }, stack, images })!;
        near(left.color, 0);
        near(right.color, 255);
    });

    it('lets a translucent ancestor tint what is behind it', () => {
        const overlay = nodeOf(stage, { color: { r: 0, g: 0, b: 0, a: 0.5 } });
        const picture = nodeOf(stage, { layers: [gradientLayer('linear-gradient(#ffffff, #ffffff)')] });
        const result = measureRegion({ rect: { x: 0, y: 0, w: 50, h: 50 }, stack: [overlay, picture], images: new Map() })!;
        near(result.color, 127.5);
    });

    it('draws a layer over its own background color', () => {
        const stack = [
            nodeOf(stage, {
                color: { r: 0, g: 0, b: 255, a: 1 },
                layers: [gradientLayer('linear-gradient(rgb(255, 0, 0), transparent)')],
            }),
        ];
        const top = measureRegion({ rect: { x: 0, y: 0, w: 20, h: 5 }, stack, images: new Map() })!;
        const bottom = measureRegion({ rect: { x: 0, y: 95, w: 20, h: 5 }, stack, images: new Map() })!;
        expect(top.color.r).toBeGreaterThan(200); // near the red end
        expect(bottom.color.b).toBeGreaterThan(200); // fades to the blue underneath
    });

    it('stacks layers, topmost first', () => {
        const layers = [
            layerOf({ image: { kind: 'color', color: { r: 255, g: 0, b: 0, a: 0.5 } } }),
            layerOf({ image: { kind: 'color', color: { r: 0, g: 0, b: 255, a: 1 } } }),
        ];
        const result = measureRegion({
            rect: { x: 0, y: 0, w: 50, h: 50 },
            stack: [nodeOf(stage, { layers })],
            images: new Map(),
        })!;
        expect(result.color.r).toBeCloseTo(127.5, 1);
        expect(result.color.b).toBeCloseTo(127.5, 1);
    });

    it('returns null when an image layer has no pixels loaded', () => {
        const layers = [layerOf({ image: { kind: 'url', url: 'missing.png' } })];
        expect(
            measureRegion({ rect: { x: 0, y: 0, w: 20, h: 20 }, stack: [nodeOf(stage, { layers })], images: new Map() })
        ).toBeNull();
    });

    it('returns null when a node with layers has no layout', () => {
        const layers = [gradientLayer('linear-gradient(#000000, #ffffff)')];
        const empty = nodeOf({ x: 0, y: 0, w: 0, h: 0 }, { layers });
        expect(measureRegion({ rect: { x: 0, y: 0, w: 20, h: 20 }, stack: [empty], images: new Map() })).toBeNull();
    });

    it('handles a very large region without trouble', () => {
        const big: Box = { x: 0, y: 0, w: 5000, h: 4000 };
        const stack = [nodeOf(big, { layers: [gradientLayer('linear-gradient(#000000, #ffffff)')] })];
        const result = measureRegion({ rect: big, stack, images: new Map() })!;
        near(result.color, 127.5, 3);
    });
});

describe('readBackgroundStack', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    function stubRect(el: Element, x: number, y: number, w: number, h: number) {
        Object.defineProperty(el, 'getBoundingClientRect', {
            value: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }),
        });
    }

    function build(parentStyle: string): { parent: HTMLElement; button: HTMLElement } {
        const parent = document.createElement('div');
        parent.setAttribute('style', parentStyle);
        const button = document.createElement('button');
        parent.appendChild(button);
        document.body.appendChild(parent);
        return { parent, button };
    }

    it('reads color, layers, urls and geometry from the ancestors', () => {
        const { parent, button } = build(
            'background-color: rgb(10, 20, 30); background-image: linear-gradient(90deg, #000, #fff), url(photo.png); ' +
                'background-size: cover; border: 3px solid red; padding: 5px'
        );
        stubRect(parent, 100, 50, 400, 300);

        const stack = readBackgroundStack(button)!;
        expect(stack.urls).toEqual(['photo.png']);
        expect(stack.nodes).toHaveLength(1);

        const [node] = stack.nodes;
        expect(node.color).toEqual({ r: 10, g: 20, b: 30, a: 1 });
        expect(node.layers.map((l) => l.image.kind)).toEqual(['gradient', 'url']);
        expect(node.box).toEqual({ x: 100, y: 50, w: 400, h: 300 });
        expect(node.geometry.borderWidths.top).toBe(3);
        expect(node.geometry.padding.left).toBe(5);
        expect(node.geometry.viewport).toEqual({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    });

    it('skips ancestors with nothing painted', () => {
        const outer = document.createElement('div');
        outer.setAttribute('style', 'background-color: rgba(0, 0, 0, 0.5)');
        const middle = document.createElement('div');
        const button = document.createElement('button');
        middle.appendChild(button);
        outer.appendChild(middle);
        document.body.appendChild(outer);

        const stack = readBackgroundStack(button)!;
        expect(stack.nodes).toHaveLength(1);
        expect(stack.nodes[0].color?.a).toBe(0.5);
    });

    it('stops at the first fully opaque color', () => {
        const outer = document.createElement('div');
        outer.setAttribute('style', 'background-image: linear-gradient(#000, #fff)');
        const inner = document.createElement('div');
        inner.setAttribute('style', 'background-color: rgb(1, 2, 3)');
        const button = document.createElement('button');
        inner.appendChild(button);
        outer.appendChild(inner);
        document.body.appendChild(outer);

        const stack = readBackgroundStack(button)!;
        expect(stack.nodes).toHaveLength(1);
        expect(stack.nodes[0].color).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    });

    it('keeps going past a translucent color to the image behind it', () => {
        const outer = document.createElement('div');
        outer.setAttribute('style', 'background-image: url(photo.png)');
        const inner = document.createElement('div');
        inner.setAttribute('style', 'background-color: rgba(0, 0, 0, 0.4)');
        const button = document.createElement('button');
        inner.appendChild(button);
        outer.appendChild(inner);
        document.body.appendChild(outer);

        const stack = readBackgroundStack(button)!;
        expect(stack.nodes).toHaveLength(2);
        expect(stack.urls).toEqual(['photo.png']);
    });

    it('returns null when a background uses something unsupported', () => {
        const { button } = build('background-image: url(a.png); background-size: 2em');
        expect(readBackgroundStack(button)).toBeNull();
    });

    it('returns an empty stack when nothing is painted', () => {
        const { button } = build('');
        expect(readBackgroundStack(button)).toEqual({ nodes: [], urls: [] });
    });
});