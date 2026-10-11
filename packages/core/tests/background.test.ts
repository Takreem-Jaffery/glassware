// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { findEffectiveBackground, compositeOver } from '../src/background'

beforeEach(() => {
    document.body.innerHTML = '';
});

// Helper: build <div style=parentStyle><button></button></div> and return the button
function buttonInside(parentStyle: string): HTMLElement {
    const parent = document.createElement('div');
    parent.setAttribute('style', parentStyle);
    const button = document.createElement('button');
    parent.appendChild(button);
    document.body.appendChild(parent);
    return button;
}

describe('compositeOver', () => {
    it('blends 50% black over white into mid-gray', () => {
        const result = compositeOver({ r: 0, g: 0, b: 0, a: 0.5}, { r: 255, g: 255, b: 255, a: 1});
        expect(result.r).toBeCloseTo(127.5);
        expect(result.a).toBe(1);
    });
});

describe('findEffectiveBackground', () => {
    it('finds a solid parent background', () => {
        const button = buttonInside('background-color: rgb(10, 20, 30)');
        expect(findEffectiveBackground(button)).toEqual({
            kind: 'color',
            color: { r: 10, g: 20, b: 30, a: 1},
        });
    });

    it('skips transpearent ancestors to find a solid one', () => {
        const outer = document.createElement('div');
        outer.setAttribute('style', 'background-color: rgb(200,0,0)');
        const middle = document.createElement('div'); //no background at all
        const button = document.createElement('button');
        middle.appendChild(button);
        outer.append(middle);
        document.body.appendChild(outer);

        const result = findEffectiveBackground(button);
        expect(result).toEqual({ kind: 'color', color: { r: 200, g: 0, b: 0, a: 1}});

    });

    it('blends a translucent background over the default white page', () => {
        const button = buttonInside('background-color: rgba(0,0,0,0.5)');
        const result = findEffectiveBackground(button);
        expect(result.kind).toBe('color');
        if (result.kind === 'color') expect(result.color.r).toBeCloseTo(127.5);
    });

    it('reports an image when an ancestor has a background image', () => {
        const button = buttonInside('background-image: url(photo.png)');
        expect(findEffectiveBackground(button).kind).toBe('image');
    });

    it('falls back to white when nothing has a background', () => {
        const button = buttonInside('');
        expect(findEffectiveBackground(button)).toEqual({
            kind: 'color',
            color: { r: 255, g: 255, b: 255, a: 1 },
        });
    });
});