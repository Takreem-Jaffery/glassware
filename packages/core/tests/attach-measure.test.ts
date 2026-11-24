// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { attach, type BackgroundSampler } from '../src/index';
import { TEXT_COLORS } from '../src/visual';

beforeEach(() => {
    document.body.innerHTML = '';
});

function makeButton(parentStyle = '', attrs: Record<string, string> = {}): HTMLButtonElement {
    const parent = document.createElement('div');
    if (parentStyle) parent.setAttribute('style', parentStyle);
    const button = document.createElement('button');
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    parent.appendChild(button);
    document.body.appendChild(parent);
    return button;
}

const textColor = (el: HTMLElement) => el.style.getPropertyValue('--glass-text-color');
const gray = (value: number) => ({ r: value, g: value, b: value, a: 1 });

describe('attach: sampleBackground option', () => {
    it('uses the sampler to choose the text color', async () => {
        const button = makeButton('background: #ffffff');
        const handle = attach(button, {}, { sampleBackground: () => gray(0) });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.light);
    });

    it('is given the element rectangle', async () => {
        const button = makeButton();
        Object.defineProperty(button, 'getBoundingClientRect', {
            value: () => ({ left: 5, top: 6, width: 70, height: 30, right: 75, bottom: 36, x: 5, y: 6 }),
        });
        let seen: DOMRect | undefined;
        const handle = attach(button, {}, {
            sampleBackground: (rect) => {
                seen = rect;
                return gray(255);
            },
        });
        await handle.ready;
        expect(seen).toMatchObject({ left: 5, top: 6, width: 70, height: 30 });
    });

    it('measures again on refresh, so a moving backdrop is followed', async () => {
        const button = makeButton();
        let value = 255;
        const handle = attach(button, {}, { sampleBackground: () => gray(value) });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.dark);

        value = 0;
        await handle.refresh();
        expect(textColor(button)).toBe(TEXT_COLORS.light);
    });

    it('is ignored when the mode is declared in the config', async () => {
        const button = makeButton();
        let calls = 0;
        const handle = attach(button, { contrastMode: 'light' }, {
            sampleBackground: () => {
                calls++;
                return gray(0);
            },
        });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.dark);
        expect(calls).toBe(0);
    });

    it('falls back to the CSS background when the sampler returns null', async () => {
        const button = makeButton('background: rgb(0, 0, 0)');
        const handle = attach(button, {}, { sampleBackground: () => null });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.light);
        expect(handle.measurement?.source).toBe('color');
    });
});

describe('attach: handle.measurement', () => {
    it('is null before the first measurement finishes', () => {
        const handle = attach(makeButton(), {}, { sampleBackground: () => gray(0) });
        expect(handle.measurement).toBeNull();
    });

    it('holds the luminance, color and source once ready', async () => {
        const handle = attach(makeButton(), {}, { sampleBackground: () => gray(255) });
        await handle.ready;
        expect(handle.measurement?.source).toBe('custom');
        expect(handle.measurement?.luminance).toBeCloseTo(1, 5);
        expect(handle.measurement?.color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });

    it('is null when the mode is declared', async () => {
        const handle = attach(makeButton('', { 'data-glass-mode': 'dark' }), {}, {
            sampleBackground: () => gray(255),
        });
        await handle.ready;
        expect(handle.measurement).toBeNull();
    });

    it('updates when the backdrop changes', async () => {
        let value = 255;
        const handle = attach(makeButton(), {}, { sampleBackground: () => gray(value) });
        await handle.ready;
        const before = handle.measurement!.luminance;
        value = 0;
        await handle.refresh();
        expect(handle.measurement!.luminance).toBeLessThan(before);
    });

    it('goes back to null when a declared mode takes over', async () => {
        const button = makeButton();
        const handle = attach(button, {}, { sampleBackground: () => gray(255) });
        await handle.ready;
        expect(handle.measurement).not.toBeNull();
        await handle.update({ contrastMode: 'dark' });
        expect(handle.measurement).toBeNull();
    });
});

describe('attach: text color does not flicker near the threshold', () => {
    // 0.5 luminance is about channel 188. 186 is just under (about 0.49),
    // 190 just over (about 0.51): inside the margin either side.
    it('keeps the current color while the backdrop hovers around the threshold', async () => {
        const button = makeButton();
        let value = 255;
        const handle = attach(button, {}, { sampleBackground: () => gray(value) });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.dark);

        for (const wobble of [190, 186, 189, 185, 188]) {
            value = wobble;
            await handle.refresh();
            expect(textColor(button)).toBe(TEXT_COLORS.dark);
        }
    });

    it('still switches once the backdrop is clearly darker', async () => {
        const button = makeButton();
        let value = 255;
        const handle = attach(button, {}, { sampleBackground: () => gray(value) });
        await handle.ready;
        value = 120;
        await handle.refresh();
        expect(textColor(button)).toBe(TEXT_COLORS.light);
    });

    it('decides from scratch after a declared mode, with no stickiness', async () => {
        const button = makeButton();
        const handle = attach(button, { contrastMode: 'dark' }, { sampleBackground: () => gray(186) });
        await handle.ready;
        expect(textColor(button)).toBe(TEXT_COLORS.light);
        await handle.update({ contrastMode: 'auto' });
        expect(textColor(button)).toBe(TEXT_COLORS.light); // 0.49 is below 0.5, no previous mode
    });
});