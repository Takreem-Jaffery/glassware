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