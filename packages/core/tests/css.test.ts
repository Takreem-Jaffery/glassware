import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXT_COLORS } from '../src/visual';
import { DEFAULT_DISTORTION_SCALE, DEFAULT_DISTORTION_SPEED } from '../src/watery';

const css = readFileSync(
    fileURLToPath(new URL('../src/glassware.css', import.meta.url)),
    'utf8'
);

// Guards against the stylesheet drifting from SPEC.md and from the TS constants.
describe('glassware.css matches SPEC defaults', () => {
    const tokens: Array<[string, string]> = [
        ['--glass-blur', '12px'],
        ['--glass-transparency', '0.18'],
        ['--glass-tint', 'rgba(255, 255, 255, 1)'],
        ['--glass-radius', '12px'],
        ['--glass-distortion-scale', '28'],
        ['--glass-distortion-speed', '8s'],
        ['--glass-edge-highlight', 'inset 1px 1px 1px rgba(255, 255, 255, 0.6)'],
        ['--glass-edge-shadow', 'inset -1px -1px 1px rgba(0, 0, 0, 0.15)'],
    ];

    it.each(tokens)('declares %s: %s', (name, value) => {
        expect(css).toContain(`${name}: ${value};`);
    });

    it('uses the SPEC §4 text colors from visual.ts', () => {
        expect(css).toContain(`--glass-text-dark: ${TEXT_COLORS.dark};`);
        expect(css).toContain(`--glass-text-light: ${TEXT_COLORS.light};`);
    });

    it('uses the same distortion defaults as watery.ts', () => {
        expect(css).toContain(`--glass-distortion-scale: ${DEFAULT_DISTORTION_SCALE};`);
        expect(css).toContain(`--glass-distortion-speed: ${DEFAULT_DISTORTION_SPEED}s;`);
    });

    it('maps data-glass-mode (the background) to the opposite text color', () => {
        expect(css).toMatch(
            /\[data-glass-mode="light"\]\s*\{\s*--glass-text-color:\s*var\(--glass-text-dark\)/
        );
        expect(css).toMatch(
            /\[data-glass-mode="dark"\]\s*\{\s*--glass-text-color:\s*var\(--glass-text-light\)/
        );
    });

    it('only applies the watery filter inside an @supports guard', () => {
        const guard = css.indexOf('@supports (backdrop-filter: url(#x))');
        const watery = css.indexOf('[data-glass-type="watery"]');
        expect(guard).toBeGreaterThan(-1);
        expect(watery).toBeGreaterThan(guard);
    });

    it('keeps frosted blur as the base backdrop-filter', () => {
        expect(css).toMatch(/\n\s*backdrop-filter:\s*blur\(var\(--glass-blur\)\);/);
    });
});
