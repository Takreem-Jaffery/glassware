import { describe, it, expect } from 'vitest';
import {
    createGradientPainter,
    looseGradientColor,
    parseGradient,
    parseLength,
    parsePositionTokens,
    splitTopLevel,
} from '../src/gradient';
import type { RGBA } from '../src/visual';

function painter(css: string, width: number, height: number) {
    const gradient = parseGradient(css);
    if (!gradient) throw new Error(`could not parse: ${css}`);
    return createGradientPainter(gradient, width, height);
}

function expectColor(color: RGBA, r: number, g: number, b: number, a = 1, tolerance = 0.6) {
    expect(Math.abs(color.r - r)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(color.g - g)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(color.b - b)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(color.a - a)).toBeLessThanOrEqual(0.01);
}

describe('splitTopLevel', () => {
    it('splits on commas outside parentheses', () => {
        expect(splitTopLevel('rgb(1, 2, 3) 20%, #fff', ',')).toEqual(['rgb(1, 2, 3) 20%', '#fff']);
    });

    it('splits on whitespace outside parentheses', () => {
        expect(splitTopLevel('rgba(0, 0, 0, 0.5)   40%', 'space')).toEqual(['rgba(0, 0, 0, 0.5)', '40%']);
    });

    it('keeps quoted text whole, even with commas and parentheses inside', () => {
        expect(splitTopLevel('url("data:a,b(c") , none', ',')).toEqual(['url("data:a,b(c")', 'none']);
    });

    it('drops empty parts', () => {
        expect(splitTopLevel('  a ,, b ', ',')).toEqual(['a', 'b']);
    });
});

describe('parseLength', () => {
    it('reads px, % and a bare zero', () => {
        expect(parseLength('12px')).toEqual({ value: 12, unit: 'px' });
        expect(parseLength('50%')).toEqual({ value: 50, unit: '%' });
        expect(parseLength('0')).toEqual({ value: 0, unit: 'px' });
        expect(parseLength('-.5px')).toEqual({ value: -0.5, unit: 'px' });
    });

    it('rejects other units and unitless non-zero numbers', () => {
        expect(parseLength('2em')).toBeNull();
        expect(parseLength('5')).toBeNull();
        expect(parseLength('calc(1px + 2px)')).toBeNull();
        expect(parseLength('auto')).toBeNull();
    });
});

describe('parsePositionTokens', () => {
    it('reads lengths and keywords in x y order', () => {
        expect(parsePositionTokens(['10px', '20%'])).toEqual({
            x: { value: 10, unit: 'px' },
            y: { value: 20, unit: '%' },
        });
        expect(parsePositionTokens(['left', 'top'])).toEqual({
            x: { value: 0, unit: '%' },
            y: { value: 0, unit: '%' },
        });
    });

    it('accepts swapped keywords and a single value', () => {
        expect(parsePositionTokens(['top', 'left'])).toEqual({
            x: { value: 0, unit: '%' },
            y: { value: 0, unit: '%' },
        });
        expect(parsePositionTokens(['bottom'])).toEqual({
            x: { value: 50, unit: '%' },
            y: { value: 100, unit: '%' },
        });
        expect(parsePositionTokens(['30%'])).toEqual({
            x: { value: 30, unit: '%' },
            y: { value: 50, unit: '%' },
        });
    });

    it('rejects the 3 and 4 value forms and junk', () => {
        expect(parsePositionTokens(['right', '10px', 'bottom'])).toBeNull();
        expect(parsePositionTokens([])).toBeNull();
        expect(parsePositionTokens(['banana'])).toBeNull();
    });
});

describe('parseGradient: linear', () => {
    it('defaults to "to bottom" (180deg)', () => {
        const g = parseGradient('linear-gradient(#000, #fff)');
        expect(g).toMatchObject({ kind: 'linear', repeating: false, direction: { type: 'angle', deg: 180 } });
    });

    it('reads angles in deg, turn and rad', () => {
        expect(parseGradient('linear-gradient(90deg, #000, #fff)')).toMatchObject({
            direction: { type: 'angle', deg: 90 },
        });
        expect(parseGradient('linear-gradient(0.25turn, #000, #fff)')).toMatchObject({
            direction: { type: 'angle', deg: 90 },
        });
        const rad = parseGradient('linear-gradient(3.141592653589793rad, #000, #fff)');
        expect(rad && rad.kind === 'linear' && rad.direction.type === 'angle' && rad.direction.deg).toBeCloseTo(180);
    });

    it('reads sides and corners', () => {
        expect(parseGradient('linear-gradient(to top, #000, #fff)')).toMatchObject({
            direction: { type: 'angle', deg: 0 },
        });
        expect(parseGradient('linear-gradient(to right, #000, #fff)')).toMatchObject({
            direction: { type: 'angle', deg: 90 },
        });
        expect(parseGradient('linear-gradient(to bottom left, #000, #fff)')).toMatchObject({
            direction: { type: 'corner', x: -1, y: 1 },
        });
        expect(parseGradient('linear-gradient(to left top, #000, #fff)')).toMatchObject({
            direction: { type: 'corner', x: -1, y: -1 },
        });
    });

    it('reads rgba() stops with nested commas and positions', () => {
        const g = parseGradient('linear-gradient(90deg, rgba(0, 0, 0, 0.5) 20%, rgb(255, 255, 255) 30px)');
        expect(g?.stops).toEqual([
            { color: { r: 0, g: 0, b: 0, a: 0.5 }, position: { value: 20, unit: '%' } },
            { color: { r: 255, g: 255, b: 255, a: 1 }, position: { value: 30, unit: 'px' } },
        ]);
    });

    it('turns a stop with two positions into two stops', () => {
        const g = parseGradient('linear-gradient(#000 10% 40%, #fff)');
        expect(g?.stops).toHaveLength(3);
    });

    it('marks repeating gradients', () => {
        expect(parseGradient('repeating-linear-gradient(#000, #fff 10px)')).toMatchObject({ repeating: true });
    });

    it('returns null for unsupported input', () => {
        expect(parseGradient('conic-gradient(#000, #fff)')).toBeNull();
        expect(parseGradient('url(a.png)')).toBeNull();
        expect(parseGradient('linear-gradient(#000)')).toBeNull();
        expect(parseGradient('linear-gradient(red, blue)')).toBeNull(); // named colors
        expect(parseGradient('linear-gradient(#000, 30%, #fff)')).toBeNull(); // color hint
        expect(parseGradient('linear-gradient(to middle, #000, #fff)')).toBeNull();
        expect(parseGradient('linear-gradient(#000 2em, #fff)')).toBeNull();
        expect(parseGradient('none')).toBeNull();
    });
});

describe('parseGradient: radial', () => {
    it('defaults to an ellipse reaching the farthest corner, centered', () => {
        expect(parseGradient('radial-gradient(#fff, #000)')).toMatchObject({
            kind: 'radial',
            shape: 'ellipse',
            size: { type: 'extent', extent: 'farthest-corner' },
            at: { x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' } },
        });
    });

    it('reads shape, position and extent keywords', () => {
        expect(parseGradient('radial-gradient(circle at 30% 30%, #fff, #000)')).toMatchObject({
            shape: 'circle',
            at: { x: { value: 30, unit: '%' }, y: { value: 30, unit: '%' } },
        });
        expect(parseGradient('radial-gradient(closest-side at left top, #fff, #000)')).toMatchObject({
            size: { type: 'extent', extent: 'closest-side' },
            at: { x: { value: 0, unit: '%' }, y: { value: 0, unit: '%' } },
        });
    });

    it('reads explicit sizes: one length is a circle, two are an ellipse', () => {
        expect(parseGradient('radial-gradient(40px at 10px 20px, #fff, #000)')).toMatchObject({
            shape: 'circle',
            size: { type: 'explicit', x: { value: 40, unit: 'px' }, y: null },
        });
        expect(parseGradient('radial-gradient(40px 20px, #fff, #000)')).toMatchObject({
            shape: 'ellipse',
            size: { type: 'explicit', x: { value: 40, unit: 'px' }, y: { value: 20, unit: 'px' } },
        });
    });

    it('rejects impossible size combinations', () => {
        expect(parseGradient('radial-gradient(circle 10%, #fff, #000)')).toBeNull();
        expect(parseGradient('radial-gradient(circle 10px 20px, #fff, #000)')).toBeNull();
        expect(parseGradient('radial-gradient(closest-side 10px, #fff, #000)')).toBeNull();
    });

    it('marks repeating gradients', () => {
        expect(parseGradient('repeating-radial-gradient(circle, #000, #fff 10px)')).toMatchObject({
            repeating: true,
        });
    });
});

describe('painter: linear', () => {
    it('runs left to right at 90deg', () => {
        const paint = painter('linear-gradient(90deg, #000000, #ffffff)', 100, 50);
        expectColor(paint(0, 25), 0, 0, 0);
        expectColor(paint(50, 25), 127.5, 127.5, 127.5);
        expectColor(paint(100, 25), 255, 255, 255);
        expectColor(paint(50, 0), 127.5, 127.5, 127.5); // y does not matter
    });

    it('runs top to bottom by default and reversed at 0deg', () => {
        const down = painter('linear-gradient(#000000, #ffffff)', 50, 100);
        expectColor(down(25, 0), 0, 0, 0);
        expectColor(down(25, 100), 255, 255, 255);
        const up = painter('linear-gradient(0deg, #000000, #ffffff)', 50, 100);
        expectColor(up(25, 0), 255, 255, 255);
        expectColor(up(25, 100), 0, 0, 0);
    });

    it('runs corner to corner for "to bottom right" in a square', () => {
        const paint = painter('linear-gradient(to bottom right, #000000, #ffffff)', 100, 100);
        expectColor(paint(0, 0), 0, 0, 0);
        expectColor(paint(100, 100), 255, 255, 255);
        expectColor(paint(50, 50), 127.5, 127.5, 127.5);
        expectColor(paint(100, 0), 127.5, 127.5, 127.5);
    });

    it('puts the 50% line through the other two corners in a wide box', () => {
        const paint = painter('linear-gradient(to bottom right, #000000, #ffffff)', 200, 100);
        expectColor(paint(200, 0), 127.5, 127.5, 127.5);
        expectColor(paint(0, 100), 127.5, 127.5, 127.5);
        expectColor(paint(0, 0), 0, 0, 0);
        expectColor(paint(200, 100), 255, 255, 255);
    });

    it('measures px stops from the start of the line', () => {
        const paint = painter('linear-gradient(90deg, #000000 0, #ffffff 50px)', 100, 10);
        expectColor(paint(25, 5), 127.5, 127.5, 127.5);
        expectColor(paint(75, 5), 255, 255, 255);
    });

    it('makes a hard edge when two stops share a position', () => {
        const paint = painter('linear-gradient(90deg, #000000 50%, #ffffff 50%)', 100, 10);
        expectColor(paint(49, 5), 0, 0, 0);
        expectColor(paint(51, 5), 255, 255, 255);
    });

    it('spreads stops without positions evenly', () => {
        const paint = painter('linear-gradient(90deg, #ff0000, #00ff00, #0000ff)', 100, 10);
        expectColor(paint(50, 5), 0, 255, 0);
        expectColor(paint(25, 5), 127.5, 127.5, 0);
    });

    it('fills a gap around a positioned stop', () => {
        const paint = painter('linear-gradient(90deg, #000000, #808080, #ffffff 80%)', 100, 10);
        // the middle stop is spread halfway between 0% and 80%, so it sits at 40%
        expectColor(paint(40, 5), 128, 128, 128);
    });

    it('does not let a stop move backwards', () => {
        const paint = painter('linear-gradient(90deg, #000000 60%, #ffffff 30%)', 100, 10);
        expectColor(paint(59, 5), 0, 0, 0);
        expectColor(paint(61, 5), 255, 255, 255);
    });

    it('repeats a repeating gradient', () => {
        const paint = painter('repeating-linear-gradient(90deg, #000000 0, #ffffff 10px)', 100, 10);
        expectColor(paint(0, 5), 0, 0, 0);
        expectColor(paint(5, 5), 127.5, 127.5, 127.5);
        expectColor(paint(15, 5), 127.5, 127.5, 127.5);
        expectColor(paint(35, 5), 127.5, 127.5, 127.5);
        expectColor(paint(92, 5), 255 * 0.2, 255 * 0.2, 255 * 0.2);
    });

    it('fades to transparent without going gray (premultiplied alpha)', () => {
        const paint = painter('linear-gradient(90deg, rgb(255, 255, 255), transparent)', 100, 10);
        const middle = paint(50, 5);
        expectColor(middle, 255, 255, 255, 0.5);
    });

    it('survives a zero-size box', () => {
        const paint = painter('linear-gradient(90deg, #000000, #ffffff)', 0, 0);
        expect(() => paint(0, 0)).not.toThrow();
    });
});

describe('painter: radial', () => {
    it('is the first color at the center and the last at the farthest corner', () => {
        const paint = painter('radial-gradient(circle, #ffffff, #000000)', 100, 100);
        expectColor(paint(50, 50), 255, 255, 255);
        expectColor(paint(0, 0), 0, 0, 0);
        const halfway = paint(50 + Math.hypot(50, 50) / 2, 50);
        expectColor(halfway, 127.5, 127.5, 127.5);
    });

    it('closest-side ends at the nearest edge', () => {
        const paint = painter('radial-gradient(circle closest-side, #ffffff, #000000)', 100, 100);
        expectColor(paint(100, 50), 0, 0, 0);
        expectColor(paint(75, 50), 127.5, 127.5, 127.5);
    });

    it('farthest-side reaches the far edge', () => {
        const paint = painter('radial-gradient(circle farthest-side at left center, #ffffff, #000000)', 100, 100);
        expectColor(paint(0, 50), 255, 255, 255);
        expectColor(paint(100, 50), 0, 0, 0);
    });

    it('defaults to an ellipse that matches the box proportions', () => {
        const paint = painter('radial-gradient(#ffffff, #000000)', 200, 100);
        // farthest-corner ellipse: rx = 100 * sqrt(2), ry = 50 * sqrt(2)
        expectColor(paint(200, 50), 255 * (1 - 100 / (100 * Math.SQRT2)), 255 * (1 - 100 / (100 * Math.SQRT2)), 255 * (1 - 100 / (100 * Math.SQRT2)), 1, 1);
        expectColor(paint(0, 0), 0, 0, 0);
    });

    it('honors an explicit circle radius', () => {
        const paint = painter('radial-gradient(10px at 50px 50px, #ffffff, #000000)', 100, 100);
        expectColor(paint(55, 50), 127.5, 127.5, 127.5);
        expectColor(paint(90, 50), 0, 0, 0);
    });

    it('honors an explicit ellipse', () => {
        const paint = painter('radial-gradient(40px 20px at 50px 50px, #ffffff, #000000)', 100, 100);
        expectColor(paint(70, 50), 127.5, 127.5, 127.5);
        expectColor(paint(50, 60), 127.5, 127.5, 127.5);
    });

    it('moves with "at"', () => {
        const paint = painter('radial-gradient(circle at 0 0, #ffffff, #000000)', 100, 100);
        expectColor(paint(0, 0), 255, 255, 255);
        expectColor(paint(100, 100), 0, 0, 0);
    });

    it('fades a translucent glow into the background', () => {
        const paint = painter('radial-gradient(circle at 50% 50%, rgba(255, 128, 0, 0.6), rgba(0, 0, 0, 0) 50%)', 100, 100);
        expect(paint(50, 50).a).toBeCloseTo(0.6, 2);
        expect(paint(0, 0).a).toBe(0);
        expect(paint(50, 50).r).toBeCloseTo(255, 0);
    });

    it('repeats a repeating radial gradient', () => {
        const paint = painter('repeating-radial-gradient(circle at 0 0, #000000 0, #ffffff 10px)', 100, 100);
        expectColor(paint(0, 0), 0, 0, 0);
        expectColor(paint(5, 0), 127.5, 127.5, 127.5);
        expectColor(paint(15, 0), 127.5, 127.5, 127.5);
    });

    it('survives a degenerate radius', () => {
        const paint = painter('radial-gradient(circle closest-side at 0 0, #ffffff, #000000)', 100, 100);
        expect(() => paint(10, 10)).not.toThrow();
        expectColor(paint(10, 10), 0, 0, 0);
    });
});

describe('looseGradientColor', () => {
    it('averages the colors it can read', () => {
        const color = looseGradientColor('conic-gradient(#000000, #ffffff)');
        expectColor(color as RGBA, 127.5, 127.5, 127.5);
    });

    it('weights by alpha so transparent stops do not gray the color out', () => {
        const color = looseGradientColor('conic-gradient(rgb(200, 100, 50), transparent)') as RGBA;
        expect(color.r).toBeCloseTo(200);
        expect(color.a).toBeCloseTo(0.5);
    });

    it('returns null when there is nothing readable, and ignores url()', () => {
        expect(looseGradientColor('conic-gradient(red, blue)')).toBeNull();
        expect(looseGradientColor('url(a#abc.png)')).toBeNull();
    });
});