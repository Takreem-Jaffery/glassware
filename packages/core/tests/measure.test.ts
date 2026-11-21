// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    measureBackground,
    resolveContrast,
    resolveContrastMode,
    type PixelReader,
    type BackgroundSampler,
} from '../src/sampling';

beforeEach(() => {
    document.body.innerHTML = '';
});

type Rect = [x: number, y: number, w: number, h: number];

// jsdom has no layout, so boxes are stubbed.
function stubRect(el: Element, [x, y, w, h]: Rect) {
    Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON() {} }),
    });
}

function build(parentStyle: string, parentRect: Rect | null, buttonRect: Rect | null, attrs: Record<string, string> = {}) {
    const parent = document.createElement('div');
    parent.setAttribute('style', parentStyle);
    const button = document.createElement('button');
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    parent.appendChild(button);
    document.body.appendChild(parent);
    if (parentRect) stubRect(parent, parentRect);
    if (buttonRect) stubRect(button, buttonRect);
    return { parent, button };
}

// A 2 x 1 picture: left pixel black, right pixel white.
const halfAndHalf: PixelReader = async () => ({
    width: 2,
    height: 1,
    data: [0, 0, 0, 255, 255, 255, 255, 255],
});

describe('measureBackground: custom sampler', () => {
    it('is asked about the element rectangle and its color is used', async () => {
        const { button } = build('background: #ffffff', null, [10, 20, 100, 40]);
        const sampler = vi.fn<BackgroundSampler>(() => ({ r: 0, g: 0, b: 0, a: 1 }));
        const m = await measureBackground(button, { deps: { sampleBackground: sampler } });

        expect(sampler).toHaveBeenCalledTimes(1);
        expect(sampler.mock.calls[0][0]).toMatchObject({ left: 10, top: 20, width: 100, height: 40 });
        expect(m).toMatchObject({ source: 'custom', luminance: 0 });
    });

    it('accepts a promise', async () => {
        const { button } = build('background: #ffffff', null, null);
        const m = await measureBackground(button, {
            deps: { sampleBackground: async () => ({ r: 255, g: 255, b: 255, a: 1 }) },
        });
        expect(m?.source).toBe('custom');
        expect(m?.luminance).toBeCloseTo(1, 5);
    });

    it('averages the pixels of an ImagePixels result', async () => {
        const { button } = build('background: #ffffff', null, null);
        const m = await measureBackground(button, {
            deps: {
                sampleBackground: () => ({
                    width: 2,
                    height: 1,
                    data: [0, 0, 0, 255, 255, 255, 255, 255],
                }),
            },
        });
        expect(m?.source).toBe('custom');
        expect(m?.luminance).toBeCloseTo(0.5, 5);
        expect(m?.color.r).toBeCloseTo(127.5, 5);
    });

    it('shows translucent results over white', async () => {
        const { button } = build('background: #000000', null, null);
        const m = await measureBackground(button, {
            deps: { sampleBackground: () => ({ r: 0, g: 0, b: 0, a: 0 }) },
        });
        expect(m?.luminance).toBeCloseTo(1, 5);
    });

    it.each([
        ['null', () => null],
        ['undefined', () => undefined],
        ['a throw', () => { throw new Error('boom'); }],
        ['a rejection', () => Promise.reject(new Error('boom'))],
        ['unusable pixels', () => ({ width: 4, height: 4, data: [0] })],
    ])('falls back to the CSS background on %s', async (_name, sampler) => {
        const { button } = build('background: rgb(0, 0, 0)', null, null);
        const m = await measureBackground(button, {
            deps: { sampleBackground: sampler as BackgroundSampler },
        });
        expect(m).toMatchObject({ source: 'color', luminance: 0 });
    });
});

describe('measureBackground: region under the element', () => {
    it('measures only the part of a gradient under the element', async () => {
        const gradient = 'background-image: linear-gradient(90deg, #000000, #ffffff)';
        const left = build(gradient, [0, 0, 1000, 400], [0, 100, 100, 40]);
        const mLeft = await measureBackground(left.button);
        expect(mLeft?.source).toBe('region');
        expect(mLeft!.luminance).toBeLessThan(0.05);

        document.body.innerHTML = '';
        const right = build(gradient, [0, 0, 1000, 400], [900, 100, 100, 40]);
        const mRight = await measureBackground(right.button);
        expect(mRight!.luminance).toBeGreaterThan(0.7);
    });

    it('follows the element when it moves (a fresh rect each time)', async () => {
        const { button } = build(
            'background-image: linear-gradient(90deg, #000000, #ffffff)',
            [0, 0, 1000, 400],
            [0, 100, 100, 40]
        );
        const before = await measureBackground(button);
        stubRect(button, [900, 100, 100, 40]);
        const after = await measureBackground(button);
        expect(after!.luminance).toBeGreaterThan(before!.luminance + 0.5);
    });

    it('reads image pixels through the supplied reader', async () => {
        const reader = vi.fn(halfAndHalf);
        const style = 'background-image: url(photo.png); background-size: 100% 100%; background-repeat: no-repeat';

        const dark = build(style, [0, 0, 1000, 400], [0, 100, 100, 40]);
        const mDark = await measureBackground(dark.button, { deps: { readPixels: reader } });
        expect(mDark).toMatchObject({ source: 'region' });
        expect(mDark!.luminance).toBeLessThan(0.05);
        expect(reader).toHaveBeenCalledWith('photo.png');

        document.body.innerHTML = '';
        const light = build(style, [0, 0, 1000, 400], [900, 100, 100, 40]);
        const mLight = await measureBackground(light.button, { deps: { readPixels: reader } });
        expect(mLight!.luminance).toBeGreaterThan(0.95);
        expect(reader).toHaveBeenCalledTimes(1); // decoded once, reused
    });

    it('measures where the element is after the image finishes loading', async () => {
        const style = 'background-image: url(slow.png); background-size: 100% 100%; background-repeat: no-repeat';
        const { button } = build(style, [0, 0, 1000, 400], [0, 100, 100, 40]);
        const slow: PixelReader = async (url) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            stubRect(button, [900, 100, 100, 40]); // moved while loading
            return halfAndHalf(url);
        };
        const m = await measureBackground(button, { deps: { readPixels: slow } });
        expect(m!.luminance).toBeGreaterThan(0.95);
    });

    it('uses the page color behind a translucent overlay', async () => {
        const outer = document.createElement('div');
        outer.setAttribute('style', 'background: rgb(0, 0, 0)');
        const inner = document.createElement('div');
        inner.setAttribute('style', 'background: rgba(255, 255, 255, 0.2)');
        const button = document.createElement('button');
        inner.appendChild(button);
        outer.appendChild(inner);
        document.body.appendChild(outer);
        stubRect(outer, [0, 0, 500, 500]);
        stubRect(inner, [0, 0, 500, 500]);
        stubRect(button, [100, 100, 80, 30]);

        const m = await measureBackground(button);
        expect(m?.source).toBe('region');
        expect(m!.color.r).toBeCloseTo(51, 0); // 20% white over black
    });

    it('falls back to the whole-image estimate when the image cannot be read', async () => {
        const { button } = build(
            'background-image: url(blocked.png), linear-gradient(#000000, #000000)',
            [0, 0, 1000, 400],
            [0, 100, 100, 40]
        );
        const failing: PixelReader = async () => null;
        const m = await measureBackground(button, { deps: { readPixels: failing } });
        expect(m?.source).not.toBe('region');
    });

    it('does not load images when the element has no size', async () => {
        const reader = vi.fn(halfAndHalf);
        const { button } = build('background-image: url(photo.png)', [0, 0, 1000, 400], [0, 0, 0, 0]);
        await measureBackground(button, { deps: { readPixels: reader } });
        // the rough estimate may read the image once; the region path must not
        expect(reader.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('measureBackground: other sources', () => {
    it('reports a solid color when there is no layout', async () => {
        const { button } = build('background: rgb(255, 255, 255)', null, null);
        expect(await measureBackground(button)).toMatchObject({ source: 'color' });
    });

    it('averages the whole image when there is no layout', async () => {
        const { button } = build('background-image: url(photo.png)', null, null);
        const m = await measureBackground(button, { deps: { readPixels: halfAndHalf } });
        expect(m?.source).toBe('image');
    });

    it('uses data-glass-bg when a background image cannot be read', async () => {
        const { button } = build('background-image: url(photo.png)', null, null, { 'data-glass-bg': '#000000' });
        const m = await measureBackground(button, { deps: { readPixels: async () => null } });
        expect(m).toMatchObject({ source: 'hint', luminance: 0 });
    });

    it('returns null when nothing can be measured', async () => {
        const { button } = build('background-image: url(photo.png)', null, null);
        expect(await measureBackground(button, { deps: { readPixels: async () => null } })).toBeNull();
    });
});

describe('resolveContrast', () => {
    const black: BackgroundSampler = () => ({ r: 0, g: 0, b: 0, a: 1 });
    const white: BackgroundSampler = () => ({ r: 255, g: 255, b: 255, a: 1 });

    it('returns the mode together with what was measured', async () => {
        const { button } = build('', null, null);
        const result = await resolveContrast(button, { deps: { sampleBackground: black } });
        expect(result.mode).toBe('light');
        expect(result.measurement).toMatchObject({ source: 'custom', luminance: 0 });
    });

    it('lets contrastMode beat the sampler, with no measurement', async () => {
        const { button } = build('', null, null);
        const sampler = vi.fn(black);
        const result = await resolveContrast(button, {
            contrastMode: 'light',
            deps: { sampleBackground: sampler },
        });
        expect(result).toEqual({ mode: 'dark', measurement: null });
        expect(sampler).not.toHaveBeenCalled();
    });

    it('lets data-glass-mode beat the sampler', async () => {
        const { button } = build('', null, null, { 'data-glass-mode': 'dark' });
        const result = await resolveContrast(button, { deps: { sampleBackground: white } });
        expect(result).toEqual({ mode: 'light', measurement: null });
    });

    it('defaults to dark text when nothing can be measured', async () => {
        const { button } = build('background-image: url(photo.png)', null, null);
        const result = await resolveContrast(button, { deps: { readPixels: async () => null } });
        expect(result).toEqual({ mode: 'dark', measurement: null });
    });

    it('is sticky around the threshold when given the previous mode', async () => {
        const { button } = build('', null, null);
        // luminance just below 0.5: channel 187 is about 0.497
        const nearHalf: BackgroundSampler = () => ({ r: 187, g: 187, b: 187, a: 1 });
        const deps = { sampleBackground: nearHalf };

        expect((await resolveContrast(button, { deps })).mode).toBe('light');
        expect((await resolveContrast(button, { previous: 'dark', deps })).mode).toBe('dark');
        expect((await resolveContrast(button, { previous: 'light', deps })).mode).toBe('light');
    });

    it('passes the threshold through', async () => {
        const { button } = build('', null, null);
        const gray: BackgroundSampler = () => ({ r: 128, g: 128, b: 128, a: 1 }); // about 0.22
        expect((await resolveContrast(button, { deps: { sampleBackground: gray } })).mode).toBe('light');
        expect((await resolveContrast(button, { threshold: 0.18, deps: { sampleBackground: gray } })).mode).toBe('dark');
    });
});

describe('resolveContrastMode (unchanged wrapper)', () => {
    it('still returns just the mode', async () => {
        const { button } = build('background: rgb(0, 0, 0)', null, null);
        expect(await resolveContrastMode(button)).toBe('light');
    });
});