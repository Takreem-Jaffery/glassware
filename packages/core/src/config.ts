import type { BackgroundTone } from './visual';

// SPEC §7 config schema (web).
export type GlassType = 'frosted' | 'watery';

export interface GlassConfig {
    type?: GlassType; // default 'frosted'; 'watery' falls back automatically
    transparency?: number; // 0.05-0.45, fill alpha (default 0.18 frosted, 0.08 watery)
    tint?: string; // any CSS color, default white
    blur?: number; // px, 4-24 (default 12 frosted, 4 watery)
    radius?: number; // px, 0-32
    edgeReflection?: boolean; // default true
    contrastMode?: 'auto' | BackgroundTone; // 'light'/'dark' declare the BACKGROUND (SPEC §4)
    distortionScale?: number; // 10-50, watery only (default 40)
    distortionSpeed?: number; // seconds, 4-16, watery only (default 8)

    // Reserved by SPEC §5/§7 for later phases. Accepted so config objects stay
    // forward compatible, but attach() does nothing with them yet.
    sound?: string | null;
    crack?: { enabled: boolean; clicksUntilCrack: number; resetOnReload: boolean };
}

// A config that has been checked: every key that is present is valid and
// in range. Absent keys mean "not set by the developer", so the stylesheet
// default applies.
export type ResolvedConfig = Readonly<GlassConfig>;

export const RANGES = {
    transparency: [0.05, 0.45],
    blur: [4, 24],
    radius: [0, 32],
    distortionScale: [10, 50],
    distortionSpeed: [4, 16],
} as const;

type NumericKey = keyof typeof RANGES;

const clamp = (value: number, [min, max]: readonly [number, number]) =>
    Math.min(max, Math.max(min, value));

function colorIsValid(value: string): boolean {
    // CSS.supports is missing in some environments (and in jsdom). When it
    // can't check, trust the developer rather than drop their tint.
    try {
        if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
            return CSS.supports('color', value);
        }
    } catch {
        // fall through
    }
    return true;
}

// Validate a developer-supplied config.
//  - numbers are clamped into the SPEC range
//  - anything invalid (wrong type, NaN, unknown value) is dropped, so the
//    default applies instead of a broken value reaching the stylesheet
//  - keys set to undefined count as not set
// Never throws, and never mutates its input.
export function resolveConfig(input: GlassConfig | null | undefined): ResolvedConfig {
    const out: GlassConfig = {};
    if (!input || typeof input !== 'object') return out;

    if (input.type === 'frosted' || input.type === 'watery') out.type = input.type;

    for (const key of Object.keys(RANGES) as NumericKey[]) {
        const value = input[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            out[key] = clamp(value, RANGES[key]);
        }
    }

    if (typeof input.tint === 'string') {
        const tint = input.tint.trim();
        if (tint && colorIsValid(tint)) out.tint = tint;
    }

    if (typeof input.edgeReflection === 'boolean') out.edgeReflection = input.edgeReflection;

    if (
        input.contrastMode === 'auto' ||
        input.contrastMode === 'light' ||
        input.contrastMode === 'dark'
    ) {
        out.contrastMode = input.contrastMode;
    }

    // Reserved keys pass through untouched.
    if (input.sound === null || typeof input.sound === 'string') out.sound = input.sound;
    if (input.crack && typeof input.crack === 'object') out.crack = input.crack;

    return Object.freeze(out);
}