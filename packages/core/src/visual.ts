// convert single sRGB channel value (0-255) into its linear-light equivalent
// as per the WCAG relative luminance spec
function linearizeChannel(channel: number): number {
    const normalized = channel/255; 
    return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

// Compute WCAG relative luminance (0 = black, 1 = white)
export function relativeLuminance(r: number, g: number, b: number): number {
    const rLin = linearizeChannel(r);
    const gLin = linearizeChannel(g);
    const bLin = linearizeChannel(b);
    return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export type ContrastMode = 'light' | 'dark';

// Given the backgrounds relative luminance, return the which text mode
// will be legible against it.
export function pickTextMode(luminance: number, threshold = 0.5): ContrastMode {
    return luminance > threshold ? 'dark' : 'light';
}

export interface RGBA{
    r: number; //0-255
    g: number; //0-255
    b: number; //0-255
    a: number; //0-1 (0 = fully transparent)
}

// Parse a CSS color string into numeric channels
// Return null if format isn't recognized, so callers must handle failure.
export function parseColor(input: string): RGBA | null {
    const value = input.trim().toLowerCase();
    if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0};
    if (value.startsWith('#')) return parseHex(value);
    return parseRgbFunction(value);
}

function parseHex(hex: string): RGBA | null {
    const digits = hex.slice(1);
    if (!/^[0-9a-f]+$/.test(digits)) return null;

    // Expand shorthand: "f0a -> ff00aa"
    const full = 
    digits.length === 3 || digits.length === 4
        ? digits.split('').map((c) => c+c).join('')
        : digits;
    
    if (full.length !== 6 && full.length !== 8) return null;

    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: full.length === 8 ? parseInt(full.slice(6, 8), 16) /255 : 1,
    };
}

function parseRgbFunction(value: string): RGBA | null {
    const match = value.match(
        /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/
    );
    if (!match) return null;

    const clamp = (n: number) => Math.min(255, Math.max(0, n));
    let alpha = 1;
    if (match[4] !== undefined) {
        alpha = match[4].endsWith('%')
            ? parseFloat(match[4]) / 100
            : parseFloat(match[4]);
    }

    return {
        r: clamp(parseFloat(match[1])),
        g: clamp(parseFloat(match[2])),
        b: clamp(parseFloat(match[3])),
        a: Math.min(1, Math.max(0, alpha)),
    }
}