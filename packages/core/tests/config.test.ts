// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveConfig, RANGES, type GlassConfig } from '../src/config';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('resolveConfig: empty input', () => {
    it('returns an empty config for undefined, null and non-objects', () => {
        expect(resolveConfig(undefined)).toEqual({});
        expect(resolveConfig(null)).toEqual({});
        expect(resolveConfig('nope' as unknown as GlassConfig)).toEqual({});
    });

    it('does not invent defaults for keys that were not given', () => {
        expect(resolveConfig({})).toEqual({});
    });
});

describe('resolveConfig: numbers', () => {
    it('keeps in-range values as they are', () => {
        const result = resolveConfig({
            transparency: 0.3,
            blur: 10,
            radius: 20,
            distortionScale: 30,
            distortionSpeed: 6,
        });
        expect(result).toEqual({
            transparency: 0.3,
            blur: 10,
            radius: 20,
            distortionScale: 30,
            distortionSpeed: 6,
        });
    });

    it.each(Object.entries(RANGES))('clamps %s to its SPEC range', (key, [min, max]) => {
        const low = resolveConfig({ [key]: min - 100 } as GlassConfig) as Record<string, number>;
        const high = resolveConfig({ [key]: max + 100 } as GlassConfig) as Record<string, number>;
        expect(low[key]).toBe(min);
        expect(high[key]).toBe(max);
    });

    it('accepts the exact range boundaries', () => {
        expect(resolveConfig({ transparency: 0.05 }).transparency).toBe(0.05);
        expect(resolveConfig({ transparency: 0.45 }).transparency).toBe(0.45);
        expect(resolveConfig({ radius: 0 }).radius).toBe(0);
    });

    it('drops NaN, Infinity, strings and other non-numbers', () => {
        const result = resolveConfig({
            blur: NaN,
            radius: Infinity,
            transparency: '0.2' as unknown as number,
            distortionScale: null as unknown as number,
            distortionSpeed: undefined,
        });
        expect(result).toEqual({});
    });
});

describe('resolveConfig: type, contrastMode, edgeReflection', () => {
    it('accepts the valid type values', () => {
        expect(resolveConfig({ type: 'frosted' }).type).toBe('frosted');
        expect(resolveConfig({ type: 'watery' }).type).toBe('watery');
    });

    it('drops an unknown type', () => {
        expect(resolveConfig({ type: 'jelly' as never })).toEqual({});
    });

    it('accepts auto, light and dark for contrastMode and drops others', () => {
        expect(resolveConfig({ contrastMode: 'auto' }).contrastMode).toBe('auto');
        expect(resolveConfig({ contrastMode: 'light' }).contrastMode).toBe('light');
        expect(resolveConfig({ contrastMode: 'dark' }).contrastMode).toBe('dark');
        expect(resolveConfig({ contrastMode: 'purple' as never })).toEqual({});
    });

    it('keeps edgeReflection only when it is a boolean', () => {
        expect(resolveConfig({ edgeReflection: false }).edgeReflection).toBe(false);
        expect(resolveConfig({ edgeReflection: true }).edgeReflection).toBe(true);
        expect(resolveConfig({ edgeReflection: 'no' as never })).toEqual({});
    });
});

describe('resolveConfig: tint', () => {
    it('keeps a trimmed tint string', () => {
        expect(resolveConfig({ tint: '  rgba(90, 190, 255, 1) ' }).tint).toBe('rgba(90, 190, 255, 1)');
    });

    it('drops empty and non-string tints', () => {
        expect(resolveConfig({ tint: '   ' })).toEqual({});
        expect(resolveConfig({ tint: 5 as never })).toEqual({});
    });

    it('drops a tint the browser says is not a color', () => {
        vi.stubGlobal('CSS', { supports: (_prop: string, value: string) => value !== 'banana' });
        expect(resolveConfig({ tint: 'banana' })).toEqual({});
        expect(resolveConfig({ tint: 'tomato' }).tint).toBe('tomato');
    });

    it('trusts the tint when CSS.supports is unavailable', () => {
        vi.stubGlobal('CSS', undefined);
        expect(resolveConfig({ tint: 'tomato' }).tint).toBe('tomato');
    });

    it('trusts the tint when CSS.supports throws', () => {
        vi.stubGlobal('CSS', {
            supports: () => {
                throw new Error('boom');
            },
        });
        expect(resolveConfig({ tint: 'tomato' }).tint).toBe('tomato');
    });
});

describe('resolveConfig: reserved keys and safety', () => {
    it('passes the reserved sound and crack keys through', () => {
        const crack = { enabled: true, clicksUntilCrack: 5, resetOnReload: false };
        const result = resolveConfig({ sound: 'click', crack });
        expect(result.sound).toBe('click');
        expect(result.crack).toBe(crack);
    });

    it('does not mutate its input', () => {
        const input: GlassConfig = { blur: 999, tint: ' white ' };
        resolveConfig(input);
        expect(input).toEqual({ blur: 999, tint: ' white ' });
    });

    it('returns a frozen object', () => {
        expect(Object.isFrozen(resolveConfig({ blur: 8 }))).toBe(true);
    });

    it('ignores unknown keys', () => {
        expect(resolveConfig({ blur: 8, wat: 1 } as GlassConfig)).toEqual({ blur: 8 });
    });
});