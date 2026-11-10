// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    supportsWateryGlass,
    filterIdFor,
    createDisplacementFilter,
    ensureDisplacementFilter,
    DEFAULT_FILTER_ID,
} from '../src/watery';

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('supportsWateryGlass', () => {
    it('is true when CSS.supports accepts url() in backdrop-filter', () => {
        const supports = vi.fn(() => true);
        vi.stubGlobal('CSS', { supports });
        expect(supportsWateryGlass()).toBe(true);
        expect(supports).toHaveBeenCalledWith('backdrop-filter', 'url(#x)');
    });

    it('is false when CSS.supports rejects it', () => {
        vi.stubGlobal('CSS', { supports: () => false });
        expect(supportsWateryGlass()).toBe(false);
    });

    it('is false when CSS.supports is unavailable', () => {
        vi.stubGlobal('CSS', undefined);
        expect(supportsWateryGlass()).toBe(false);
    });

    it('is false instead of throwing when CSS.supports throws', () => {
        vi.stubGlobal('CSS', {
            supports: () => {
                throw new Error('nope');
            },
        });
        expect(supportsWateryGlass()).toBe(false);
    });
});

describe('filterIdFor', () => {
    it('uses the well-known id for the default scale and speed', () => {
        expect(filterIdFor()).toBe(DEFAULT_FILTER_ID);
        expect(filterIdFor(28, 8)).toBe(DEFAULT_FILTER_ID);
    });

    it('gives each other scale/speed pair its own id', () => {
        expect(filterIdFor(40, 8)).not.toBe(DEFAULT_FILTER_ID);
        expect(filterIdFor(40, 8)).not.toBe(filterIdFor(28, 5));
        expect(filterIdFor(40, 8)).toBe(filterIdFor(40, 8));
    });

    it('produces ids that are safe in url(#...) for fractional values', () => {
        expect(filterIdFor(12.5, 4.5)).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

describe('createDisplacementFilter', () => {
    it('builds a filter with the default scale, speed and id', () => {
        const svg = createDisplacementFilter();
        expect(svg.querySelector('filter')?.getAttribute('id')).toBe(DEFAULT_FILTER_ID);
        expect(svg.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('28');
        expect(svg.querySelector('animate')?.getAttribute('dur')).toBe('8s');
    });

    it('applies a custom scale and speed', () => {
        const svg = createDisplacementFilter({ scale: 40, speed: 5 });
        expect(svg.querySelector('filter')?.getAttribute('id')).toBe(filterIdFor(40, 5));
        expect(svg.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('40');
        expect(svg.querySelector('animate')?.getAttribute('dur')).toBe('5s');
    });

    it('omits the animation when animate is false', () => {
        const svg = createDisplacementFilter({ animate: false });
        expect(svg.querySelector('animate')).toBeNull();
        expect(svg.querySelector('feTurbulence')).not.toBeNull();
    });

    it('chains noise -> blur -> displacement', () => {
        const svg = createDisplacementFilter();
        expect(svg.querySelector('feTurbulence')?.getAttribute('result')).toBe('noise');
        expect(svg.querySelector('feGaussianBlur')?.getAttribute('in')).toBe('noise');
        expect(svg.querySelector('feDisplacementMap')?.getAttribute('in2')).toBe('softNoise');
    });

    it('is hidden from assistive tech but not display:none', () => {
        const svg = createDisplacementFilter();
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('style')).not.toContain('display:none');
    });
});

describe('ensureDisplacementFilter', () => {
    it('adds the filter once and returns its id', () => {
        const first = ensureDisplacementFilter();
        const second = ensureDisplacementFilter();
        expect(first).toBe(DEFAULT_FILTER_ID);
        expect(second).toBe(first);
        expect(document.querySelectorAll(`#${DEFAULT_FILTER_ID}`)).toHaveLength(1);
    });

    it('adds a separate filter for a different scale', () => {
        const a = ensureDisplacementFilter();
        const b = ensureDisplacementFilter({ scale: 45 });
        expect(b).not.toBe(a);
        expect(document.getElementById(b)).not.toBeNull();
        expect(document.getElementById(a)).not.toBeNull();
    });
});