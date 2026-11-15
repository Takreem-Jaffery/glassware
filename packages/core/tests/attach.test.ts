// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attach } from '../src/index';
import { TEXT_COLORS } from '../src/visual';
import { DEFAULT_FILTER_ID, filterIdFor } from '../src/watery';

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// <div style=parentStyle><button attrs></button></div>; returns the button
function makeButton(parentStyle = '', attrs: Record<string, string> = {}): HTMLButtonElement {
    const parent = document.createElement('div');
    if (parentStyle) parent.setAttribute('style', parentStyle);
    const button = document.createElement('button');
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    parent.appendChild(button);
    document.body.appendChild(parent);
    return button;
}

const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
const supportWatery = () => vi.stubGlobal('CSS', { supports: () => true });

function solidPixels(r: number, g: number, b: number, count = 256): number[] {
    const data: number[] = [];
    for (let i = 0; i < count; i++) data.push(r, g, b, 255);
    return data;
}

describe('attach: setup', () => {
    it('adds the glass class', () => {
        const button = makeButton();
        attach(button);
        expect(button.classList.contains('glass')).toBe(true);
    });

    it('throws a clear error for something that is not an element', () => {
        expect(() => attach(null as never)).toThrow(TypeError);
        expect(() => attach({} as never)).toThrow(/HTMLElement/);
        expect(() => attach(document.createTextNode('x') as never)).toThrow(TypeError);
    });

    it('returns the same handle when attached twice', () => {
        const button = makeButton();
        const first = attach(button, { blur: 8 });
        const second = attach(button, { radius: 4 });
        expect(second).toBe(first);
        expect(first.config).toEqual({ blur: 8, radius: 4 });
    });

    it('exposes the element and a frozen, validated config', () => {
        const button = makeButton();
        const handle = attach(button, { blur: 999 });
        expect(handle.element).toBe(button);
        expect(handle.config.blur).toBe(24);
    });
});

describe('attach: visual tokens', () => {
    it('writes only the tokens the developer set', () => {
        const button = makeButton();
        attach(button, { blur: 10 });
        expect(prop(button, '--glass-blur')).toBe('10px');
        expect(prop(button, '--glass-transparency')).toBe('');
        expect(prop(button, '--glass-radius')).toBe('');
        expect(prop(button, '--glass-tint')).toBe('');
    });

    it('writes every token with the right unit', () => {
        const button = makeButton();
        attach(button, {
            blur: 10,
            transparency: 0.3,
            radius: 20,
            tint: 'rgba(90, 190, 255, 1)',
            distortionScale: 30,
            distortionSpeed: 6,
        });
        expect(prop(button, '--glass-blur')).toBe('10px');
        expect(prop(button, '--glass-transparency')).toBe('0.3');
        expect(prop(button, '--glass-radius')).toBe('20px');
        expect(prop(button, '--glass-tint')).toBe('rgba(90, 190, 255, 1)');
        expect(prop(button, '--glass-distortion-scale')).toBe('30');
        expect(prop(button, '--glass-distortion-speed')).toBe('6s');
    });

    it('clamps out-of-range values to the SPEC ranges', () => {
        const button = makeButton();
        attach(button, { blur: 500, transparency: 0, radius: -5 });
        expect(prop(button, '--glass-blur')).toBe('24px');
        expect(prop(button, '--glass-transparency')).toBe('0.05');
        expect(prop(button, '--glass-radius')).toBe('0px');
    });

    it('ignores invalid values instead of writing them', () => {
        const button = makeButton();
        attach(button, { blur: NaN, tint: '' });
        expect(prop(button, '--glass-blur')).toBe('');
        expect(prop(button, '--glass-tint')).toBe('');
    });
});

describe('attach: edge reflection', () => {
    it('sets data-glass-edge="off" when edgeReflection is false', () => {
        const button = makeButton();
        attach(button, { edgeReflection: false });
        expect(button.getAttribute('data-glass-edge')).toBe('off');
    });

    it('removes it when edgeReflection is true', () => {
        const button = makeButton('', { 'data-glass-edge': 'off' });
        attach(button, { edgeReflection: true });
        expect(button.hasAttribute('data-glass-edge')).toBe(false);
    });

    it('leaves a hand-set attribute alone when the option is not given', () => {
        const button = makeButton('', { 'data-glass-edge': 'off' });
        attach(button);
        expect(button.getAttribute('data-glass-edge')).toBe('off');
    });
});

describe('attach: watery', () => {
    it('renders watery when supported: attribute, filter and token', () => {
        supportWatery();
        const button = makeButton();
        attach(button, { type: 'watery' });
        expect(button.getAttribute('data-glass-type')).toBe('watery');
        expect(prop(button, '--glass-distortion-filter')).toBe(`url(#${DEFAULT_FILTER_ID})`);
        expect(document.getElementById(DEFAULT_FILTER_ID)).not.toBeNull();
    });

    it('builds a matching filter for a custom scale and speed', () => {
        supportWatery();
        const button = makeButton();
        attach(button, { type: 'watery', distortionScale: 45, distortionSpeed: 5 });
        const id = filterIdFor(45, 5);
        expect(prop(button, '--glass-distortion-filter')).toBe(`url(#${id})`);
        const filter = document.getElementById(id);
        expect(filter?.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('45');
        expect(filter?.querySelector('animate')?.getAttribute('dur')).toBe('5s');
    });

    it('falls back to frosted when the browser lacks support (SPEC §1)', () => {
        vi.stubGlobal('CSS', { supports: () => false });
        const button = makeButton();
        attach(button, { type: 'watery' });
        expect(button.hasAttribute('data-glass-type')).toBe(false);
        expect(prop(button, '--glass-distortion-filter')).toBe('');
        expect(document.querySelector('filter')).toBeNull();
    });

    it('is frosted by default', () => {
        supportWatery();
        const button = makeButton();
        attach(button);
        expect(button.hasAttribute('data-glass-type')).toBe(false);
        expect(document.querySelector('filter')).toBeNull();
    });

    it('removes a hand-written data-glass-type that attach() cannot back up', () => {
        vi.stubGlobal('CSS', { supports: () => false });
        const button = makeButton('', { 'data-glass-type': 'watery' });
        attach(button);
        expect(button.hasAttribute('data-glass-type')).toBe(false);
    });

    it('skips the noise animation under prefers-reduced-motion', () => {
        supportWatery();
        // attach() reads the preference from the element's own window.
        const view = document.defaultView as unknown as { matchMedia?: unknown };
        view.matchMedia = () => ({ matches: true });
        try {
            const button = makeButton();
            attach(button, { type: 'watery' });
            const filter = document.getElementById(DEFAULT_FILTER_ID);
            expect(filter?.querySelector('feTurbulence')).not.toBeNull();
            expect(filter?.querySelector('animate')).toBeNull();
        } finally {
            delete view.matchMedia;
        }
    });

    it('switches between watery and frosted on update', async () => {
        supportWatery();
        const button = makeButton();
        const handle = attach(button, { type: 'watery' });
        expect(button.getAttribute('data-glass-type')).toBe('watery');
        await handle.update({ type: 'frosted' });
        expect(button.hasAttribute('data-glass-type')).toBe(false);
        expect(prop(button, '--glass-distortion-filter')).toBe('');
    });
});

describe('attach: text color', () => {
    it('uses light text on a dark background', async () => {
        const button = makeButton('background-color: rgb(20, 20, 20)');
        await attach(button).ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('uses dark text on a light background', async () => {
        const button = makeButton('background-color: rgb(240, 240, 240)');
        await attach(button).ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.dark);
    });

    it('lets contrastMode override the measurement (it names the background)', async () => {
        const button = makeButton('background-color: rgb(240, 240, 240)');
        await attach(button, { contrastMode: 'dark' }).ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('honors data-glass-mode', async () => {
        const button = makeButton('background-color: rgb(240, 240, 240)', {
            'data-glass-mode': 'dark',
        });
        await attach(button).ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('samples an image background through the injected reader', async () => {
        const button = makeButton('background-image: url(photo.png)');
        const readPixels = vi.fn(async () => solidPixels(10, 10, 10));
        await attach(button, {}, { readPixels }).ready;
        expect(readPixels).toHaveBeenCalledOnce();
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('falls back to data-glass-bg when sampling fails', async () => {
        const button = makeButton('background-image: url(photo.png)', {
            'data-glass-bg': '#101010',
        });
        await attach(button, {}, { readPixels: async () => null }).ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('applies visual tokens synchronously, before the text color is known', () => {
        const button = makeButton('background-color: rgb(20, 20, 20)');
        attach(button, { blur: 10 });
        expect(prop(button, '--glass-blur')).toBe('10px');
        expect(prop(button, '--glass-text-color')).toBe('');
    });

    it('refresh() measures again after the background changes', async () => {
        const button = makeButton('background-color: rgb(240, 240, 240)');
        const handle = attach(button);
        await handle.ready;
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.dark);

        (button.parentElement as HTMLElement).style.backgroundColor = 'rgb(10, 10, 10)';
        await handle.refresh();
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });

    it('ignores a slow measurement that was overtaken by a newer one', async () => {
        const button = makeButton('background-image: url(photo.png)');
        let finishSlow: (data: number[]) => void = () => {};
        const slow = new Promise<number[]>((resolve) => (finishSlow = resolve));

        const handle = attach(button, {}, { readPixels: () => slow });
        // Newer run: an explicit mode needs no sampling and finishes first.
        await handle.update({ contrastMode: 'dark' });
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);

        // The old run now finishes with a light image (which would mean dark
        // text); it must not win. Wait a full timer tick so every promise in
        // the old run has had the chance to write.
        finishSlow(solidPixels(250, 250, 250));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });
});

describe('attach: update', () => {
    it('merges new settings over the old ones', async () => {
        const button = makeButton();
        const handle = attach(button, { blur: 8, radius: 4 });
        await handle.update({ radius: 20 });
        expect(handle.config).toEqual({ blur: 8, radius: 20 });
        expect(prop(button, '--glass-blur')).toBe('8px');
        expect(prop(button, '--glass-radius')).toBe('20px');
    });

    it('goes back to the default when a key is set to undefined', async () => {
        const button = makeButton();
        const handle = attach(button, { blur: 8, radius: 4 });
        await handle.update({ blur: undefined });
        expect(handle.config).toEqual({ radius: 4 });
        expect(prop(button, '--glass-blur')).toBe('');
    });

    it('keeps the previous value when the new one is invalid', async () => {
        const button = makeButton();
        const handle = attach(button, { blur: 8 });
        await handle.update({ blur: NaN });
        expect(handle.config.blur).toBe(8);
        expect(prop(button, '--glass-blur')).toBe('8px');
    });

    it('re-resolves the text color', async () => {
        const button = makeButton('background-color: rgb(240, 240, 240)');
        const handle = attach(button);
        await handle.ready;
        await handle.update({ contrastMode: 'dark' });
        expect(prop(button, '--glass-text-color')).toBe(TEXT_COLORS.light);
    });
});

describe('attach: detach', () => {
    it('removes the class, tokens, attributes and text color it added', async () => {
        supportWatery();
        const button = makeButton('background-color: rgb(20, 20, 20)');
        const handle = attach(button, {
            type: 'watery',
            blur: 10,
            edgeReflection: false,
        });
        await handle.ready;
        handle.detach();

        expect(button.classList.contains('glass')).toBe(false);
        expect(button.hasAttribute('data-glass-type')).toBe(false);
        expect(button.hasAttribute('data-glass-edge')).toBe(false);
        expect(prop(button, '--glass-blur')).toBe('');
        expect(prop(button, '--glass-distortion-filter')).toBe('');
        expect(prop(button, '--glass-text-color')).toBe('');
    });

    it("puts back values that were on the element before attach()", () => {
        const button = makeButton('', { 'data-glass-edge': 'off' });
        button.style.setProperty('--glass-blur', '20px');
        button.classList.add('glass');

        const handle = attach(button, { blur: 6, edgeReflection: true });
        expect(prop(button, '--glass-blur')).toBe('6px');
        expect(button.hasAttribute('data-glass-edge')).toBe(false);

        handle.detach();
        expect(prop(button, '--glass-blur')).toBe('20px');
        expect(button.getAttribute('data-glass-edge')).toBe('off');
        expect(button.classList.contains('glass')).toBe(true);
    });

    it('does not write a text color that finishes after detach', async () => {
        const button = makeButton('background-image: url(photo.png)');
        let finish: (data: number[]) => void = () => {};
        const slow = new Promise<number[]>((resolve) => (finish = resolve));
        const handle = attach(button, {}, { readPixels: () => slow });

        handle.detach();
        finish(solidPixels(0, 0, 0));
        await handle.ready;
        expect(prop(button, '--glass-text-color')).toBe('');
    });

    it('is safe to call twice, and update/refresh become no-ops', async () => {
        const button = makeButton();
        const handle = attach(button, { blur: 8 });
        handle.detach();
        expect(() => handle.detach()).not.toThrow();
        await handle.update({ blur: 12 });
        await handle.refresh();
        expect(prop(button, '--glass-blur')).toBe('');
    });

    it('lets the element be attached again afterwards', () => {
        const button = makeButton();
        const first = attach(button, { blur: 8 });
        first.detach();
        const second = attach(button, { blur: 10 });
        expect(second).not.toBe(first);
        expect(prop(button, '--glass-blur')).toBe('10px');
    });
});