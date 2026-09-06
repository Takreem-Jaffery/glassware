import { describe, it, expect } from 'vitest';
import { relativeLuminance, pickTextMode } from '../src/visual';

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