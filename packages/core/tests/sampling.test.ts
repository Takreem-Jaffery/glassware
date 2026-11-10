// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    averageColors,
    averagePixels,
    extractGradientColors,
    extractImageUrl,
    readPixelsFromCanvas,
    sampleBackground,
    resolveContrastMode,
    DEFAULT_TEXT_MODE,
    type PixelReader,
} from '../src/sampling';

beforeEach(() => {
    document.body.innerHTML = '';
});

// Helper: <div style=parentStyle><button attrs></button></div>; returns both
function buttonInside(
    parentStyle: string,
    buttonAttrs: Record<string, string> = {}
): { parent: HTMLElement; button: HTMLElement } {
    const parent = document.createElement('div');
    parent.setAttribute('style', parentStyle);
    const button = document.createElement('button');
    for (const [name, value] of Object.entries(buttonAttrs)) {
        button.setAttribute(name, value);
    }
    parent.appendChild(button);
    document.body.appendChild(parent);
    return { parent, button };
}

// Fake pixel reader: `count` identical pixels
function solidPixels(r: number, g: number, b: number, a = 255, count = 256): number[] {
    const data: number[] = [];
    for (let i = 0; i < count; i++) data.push(r, g, b, a);
    return data;
}

const readerReturning = (data: ArrayLike<number> | null): PixelReader => async () => data;

describe('averageColors', () => {
    it('returns null for an empty list', () => {
        expect(averageColors([])).toBeNull();
    });

    it('averages black and white into mid-gray', () => {
        const result = averageColors([
            { r: 0, g: 0, b: 0, a: 1 },
            { r: 255, g: 255, b: 255, a: 1 },
        ]);
        expect(result?.r).toBeCloseTo(127.5);
        expect(result?.a).toBe(1);
    });

    it('flattens translucent colors over white before averaging', () => {
        const result = averageColors([{ r: 0, g: 0, b: 0, a: 0.5 }]);
        expect(result?.r).toBeCloseTo(127.5);
    });
});

describe('averagePixels', () => {
    it('returns null when there is no complete pixel', () => {
        expect(averagePixels([])).toBeNull();
        expect(averagePixels([1, 2, 3])).toBeNull();
    });

    it('averages half-black, half-white pixels', () => {
        const result = averagePixels([0, 0, 0, 255, 255, 255, 255, 255]);
        expect(result?.r).toBeCloseTo(127.5);
        expect(result?.g).toBeCloseTo(127.5);
        expect(result?.b).toBeCloseTo(127.5);
    });

    it('treats fully transparent pixels as white', () => {
        const result = averagePixels([0, 0, 0, 0]);
        expect(result).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });
});

describe('extractImageUrl', () => {
    it('handles quoted and unquoted urls', () => {
        expect(extractImageUrl('url(photo.png)')).toBe('photo.png');
        expect(extractImageUrl('url("photo.png")')).toBe('photo.png');
        expect(extractImageUrl("url('a/b.jpg')")).toBe('a/b.jpg');
    });

    it('returns null when there is no url', () => {
        expect(extractImageUrl('linear-gradient(red, blue)')).toBeNull();
    });
});

describe('extractGradientColors', () => {
    it('collects hex and rgb stops', () => {
        const colors = extractGradientColors('linear-gradient(90deg, #000000, rgb(255, 255, 255))');
        expect(colors).toHaveLength(2);
        expect(colors[0]).toEqual({ r: 0, g: 0, b: 0, a: 1 });
        expect(colors[1]).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });

    it('skips fully transparent stops', () => {
        const colors = extractGradientColors('linear-gradient(rgba(0, 0, 0, 0), #fff)');
        expect(colors).toHaveLength(1);
    });

    it('ignores # characters inside url() values', () => {
        expect(extractGradientColors('url("data:image/svg+xml,%3Csvg#abc")')).toEqual([]);
    });

    it('returns an empty list for gradients of named colors only', () => {
        expect(extractGradientColors('linear-gradient(red, blue)')).toEqual([]);
    });
});

describe('readPixelsFromCanvas', () => {
    it('resolves null instead of hanging when the image never loads', async () => {
        // jsdom never loads images, which mimics a stalled request.
        const result = await readPixelsFromCanvas('photo.png', 50);
        expect(result).toBeNull();
    });
});

describe('sampleBackground', () => {
    it('returns null when there is no background image', () => {
        const { parent } = buttonInside('');
        return expect(sampleBackground(parent)).resolves.toBeNull();
    });

    it('averages pixels from the image reader', async () => {
        const { parent } = buttonInside('background-image: url(photo.png)');
        const result = await sampleBackground(parent, {
            readPixels: readerReturning(solidPixels(10, 20, 30)),
        });
        expect(result).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    });

    it('passes the image url to the reader', async () => {
        const { parent } = buttonInside('background-image: url(photo.png)');
        let seen = '';
        await sampleBackground(parent, {
            readPixels: async (url) => {
                seen = url;
                return solidPixels(0, 0, 0);
            },
        });
        expect(seen).toContain('photo.png');
    });

    it('returns null when the reader fails and there is no gradient', async () => {
        const { parent } = buttonInside('background-image: url(photo.png)');
        const result = await sampleBackground(parent, { readPixels: readerReturning(null) });
        expect(result).toBeNull();
    });

    it('treats a throwing reader as a failed read', async () => {
        const { parent } = buttonInside('background-image: url(photo.png)');
        const result = await sampleBackground(parent, {
            readPixels: async () => {
                throw new Error('boom');
            },
        });
        expect(result).toBeNull();
    });

    it('averages gradient stops', async () => {
        const { parent } = buttonInside(
            'background-image: linear-gradient(90deg, #000000, #ffffff)'
        );
        const result = await sampleBackground(parent);
        expect(result?.r).toBeCloseTo(127.5);
    });
});

describe('resolveContrastMode', () => {
    it('uses dark text on a light solid background', async () => {
        const { button } = buttonInside('background-color: rgb(240, 240, 240)');
        expect(await resolveContrastMode(button)).toBe('dark');
    });

    it('uses light text on a dark solid background', async () => {
        const { button } = buttonInside('background-color: rgb(20, 20, 20)');
        expect(await resolveContrastMode(button)).toBe('light');
    });

    it('config "dark" (dark background) forces light text', async () => {
        const { button } = buttonInside('background-color: rgb(240, 240, 240)');
        expect(await resolveContrastMode(button, { contrastMode: 'dark' })).toBe('light');
    });

    it('config "light" (light background) forces dark text', async () => {
        const { button } = buttonInside('background-color: rgb(20, 20, 20)');
        expect(await resolveContrastMode(button, { contrastMode: 'light' })).toBe('dark');
    });

    it('config beats the data-glass-mode attribute', async () => {
        const { button } = buttonInside('', { 'data-glass-mode': 'dark' });
        expect(await resolveContrastMode(button, { contrastMode: 'light' })).toBe('dark');
    });

    it('honors data-glass-mode over the measured background', async () => {
        const { button } = buttonInside('background-color: rgb(240, 240, 240)', {
            'data-glass-mode': 'dark',
        });
        expect(await resolveContrastMode(button)).toBe('light');
    });

    it('ignores an invalid data-glass-mode and measures instead', async () => {
        const { button } = buttonInside('background-color: rgb(20, 20, 20)', {
            'data-glass-mode': 'purple',
        });
        expect(await resolveContrastMode(button)).toBe('light');
    });

    it('samples a dark image and picks light text', async () => {
        const { button } = buttonInside('background-image: url(photo.png)');
        const mode = await resolveContrastMode(button, {
            deps: { readPixels: readerReturning(solidPixels(10, 10, 10)) },
        });
        expect(mode).toBe('light');
    });

    it('samples a light image and picks dark text', async () => {
        const { button } = buttonInside('background-image: url(photo.png)');
        const mode = await resolveContrastMode(button, {
            deps: { readPixels: readerReturning(solidPixels(250, 250, 250)) },
        });
        expect(mode).toBe('dark');
    });

    it('uses data-glass-bg when sampling fails', async () => {
        const { button } = buttonInside('background-image: url(photo.png)', {
            'data-glass-bg': '#101010',
        });
        const mode = await resolveContrastMode(button, {
            deps: { readPixels: readerReturning(null) },
        });
        expect(mode).toBe('light');
    });

    it('falls back to the default when sampling fails and no hint is given', async () => {
        const { button } = buttonInside('background-image: url(photo.png)');
        const mode = await resolveContrastMode(button, {
            deps: { readPixels: readerReturning(null) },
        });
        expect(mode).toBe(DEFAULT_TEXT_MODE);
    });

    it('respects a custom threshold', async () => {
        // mid-gray: luminance ~0.21, so light text at 0.5 but dark at 0.1
        const { button } = buttonInside('background-color: rgb(128, 128, 128)');
        expect(await resolveContrastMode(button)).toBe('light');
        expect(await resolveContrastMode(button, { threshold: 0.1 })).toBe('dark');
    });
});