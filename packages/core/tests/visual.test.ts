import { describe, it, expect } from 'vitest';
import {
    relativeLuminance,
    pickTextMode,
    pickTextModeSticky,
    parseColor,
    textModeForTone,
    TEXT_COLORS,
} from '../src/visual';

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

describe('pickTextModeSticky', () => {
    it('is exactly pickTextMode when there is no previous mode', () => {
        for (const lum of [0, 0.2, 0.49, 0.5, 0.51, 0.9, 1]) {
            expect(pickTextModeSticky(lum, undefined)).toBe(pickTextMode(lum));
        }
        expect(pickTextModeSticky(0.4, undefined, 0.3)).toBe('dark');
    });

    it('keeps dark text just below the threshold', () => {
        expect(pickTextModeSticky(0.48, 'dark')).toBe('dark');
        expect(pickTextModeSticky(0.461, 'dark')).toBe('dark');
    });

    it('switches from dark text once luminance drops past the margin', () => {
        expect(pickTextModeSticky(0.45, 'dark')).toBe('light');
        expect(pickTextModeSticky(0.1, 'dark')).toBe('light');
    });

    it('keeps light text just above the threshold', () => {
        expect(pickTextModeSticky(0.52, 'light')).toBe('light');
        expect(pickTextModeSticky(0.539, 'light')).toBe('light');
    });

    it('switches from light text once luminance rises past the margin', () => {
        expect(pickTextModeSticky(0.55, 'light')).toBe('dark');
        expect(pickTextModeSticky(0.9, 'light')).toBe('dark');
    });

    it('does not flicker when luminance wobbles around the threshold', () => {
        let mode: 'light' | 'dark' | undefined;
        const seen: string[] = [];
        for (const lum of [0.52, 0.49, 0.51, 0.48, 0.5, 0.47]) {
            mode = pickTextModeSticky(lum, mode);
            seen.push(mode);
        }
        // starts dark (0.52 > 0.5) and never leaves it
        expect(new Set(seen)).toEqual(new Set(['dark']));
    });

    it('respects a custom threshold and margin', () => {
        expect(pickTextModeSticky(0.28, 'dark', 0.3, 0.05)).toBe('dark');
        expect(pickTextModeSticky(0.24, 'dark', 0.3, 0.05)).toBe('light');
        expect(pickTextModeSticky(0.34, 'light', 0.3, 0.05)).toBe('light');
        expect(pickTextModeSticky(0.36, 'light', 0.3, 0.05)).toBe('dark');
    });
});

describe('textModeForTone', () => {
    it('uses dark text on a light background', () => {
        expect(textModeForTone('light')).toBe('dark');
    });

    it('uses light text on a dark background', () => {
        expect(textModeForTone('dark')).toBe('light');
    });

    it('agrees with pickTextMode for the same background', () => {
        const lightBg = relativeLuminance(240, 240, 240);
        const darkBg = relativeLuminance(20, 20, 20);
        expect(pickTextMode(lightBg)).toBe(textModeForTone('light'));
        expect(pickTextMode(darkBg)).toBe(textModeForTone('dark'));
    });
});

describe('TEXT_COLORS', () => {
    it('matches the SPEC §4 text colors', () => {
        expect(TEXT_COLORS.dark).toBe('#1a1a1a');
        expect(TEXT_COLORS.light).toBe('#f5f5f5');
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