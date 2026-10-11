import { describe, it, expect } from 'vitest';
import { relativeLuminance, pickTextMode, parseColor } from '../src/visual';

describe('relativeLuminance', () => {
    it('return 0 for pure black', () => {
        expect(relativeLuminance(0,0,0)).toBeCloseTo(0,5);
    });

    it('returns 1 for pure white', () => {
        expect(relativeLuminance(255,255,255)).toBeCloseTo(1,5);
    });

    it('weights green higher than red or blue', () => {
        const redLum = relativeLuminance(255, 0, 0);
        const greenLum = relativeLuminance(0, 255, 0);
        const blueLum = relativeLuminance(0, 0, 255);
        expect(greenLum).toBeGreaterThan(redLum);
        expect(redLum).toBeGreaterThan(blueLum);
    });

});

describe('pickTextMode', () => {
    it('picks dark text on a light background', () => {
        const lum = relativeLuminance(240, 240, 240);
        expect(pickTextMode(lum)).toBe('dark');
    });

    it('picks light text on a dark background', () => {
        const lum = relativeLuminance(20, 20, 20);
        expect(pickTextMode(lum)).toBe('light');
    });

    it('respects a custom threshold', () => {
        // luminance of 0.4 would normally pick 'dark' at threshold 0.5,
        // but should pick 'light' if we lower the threshold to 0.3
        expect(pickTextMode(0.4, 0.5)).toBe('light');
        expect(pickTextMode(0.4, 0.3)).toBe('dark');
    });
});

describe('parseColor', () => {
    it('parses rgb()', () => {
        expect(parseColor('rgb(240, 120, 10)')).toEqual({ r: 240, g: 120, b: 10, a: 1});
    });
    
    it('parses rgba() with alpha', () => {
        expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5});
    });

    it('parses 6-digit and 3-digit hex', () => {
        expect(parseColor('#1a1a1a')).toEqual({ r: 26, g: 26, b: 26, a: 1});
        expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1});
    })

    it('treats "transparent" as alpha 0', () => {
        expect(parseColor('transparent')?.a).toBe(0);
    });

    it('returns null for unsupported or invalid input', () => {
        expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
        expect(parseColor('not a color')).toBeNull();
        expect(parseColor('#12')).toBeNull();
    });
});