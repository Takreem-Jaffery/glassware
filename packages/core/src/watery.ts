// Support for the "watery" glass type (SPEC §1): detecting whether the browser
// can run it, and building the SVG displacement filter it needs.

export const DEFAULT_DISTORTION_SCALE = 28; // SPEC §2: feDisplacementMap scale
export const DEFAULT_DISTORTION_SPEED = 8; // SPEC §2: noise animation, seconds
export const DEFAULT_FILTER_ID = 'glassware-displacement';

const SVG_NS = 'http://www.w3.org/2000/svg';

// SPEC §1 fallback rule: check before using watery, and render frosted when
// this returns false. Never throws.
//
// Note: this reports whether the browser accepts the syntax. Confirm in each
// target browser that an accepting browser also actually renders the filter.
export function supportsWateryGlass(): boolean {
    try {
        return (
            typeof CSS !== 'undefined' &&
            typeof CSS.supports === 'function' &&
            CSS.supports('backdrop-filter', 'url(#x)')
        );
    } catch {
        return false;
    }
}

export interface DisplacementFilterOptions {
    scale?: number; // feDisplacementMap scale (SPEC range 10-50)
    speed?: number; // seconds per noise cycle (SPEC range 4-16)
    animate?: boolean; // false for a static distortion, e.g. reduced motion
}

const slug = (n: number) => String(n).replace(/[^0-9a-z]/gi, '_');

// SVG filter attributes can't read CSS variables, so each distinct
// scale/speed pair needs its own filter, and therefore its own id.
// The defaults share one well-known id that glassware.css points at.
export function filterIdFor(
    scale: number = DEFAULT_DISTORTION_SCALE,
    speed: number = DEFAULT_DISTORTION_SPEED
): string {
    if (scale === DEFAULT_DISTORTION_SCALE && speed === DEFAULT_DISTORTION_SPEED) {
        return DEFAULT_FILTER_ID;
    }
    return `${DEFAULT_FILTER_ID}-${slug(scale)}-${slug(speed)}`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
    doc: Document,
    name: K,
    attrs: Record<string, string>
): SVGElementTagNameMap[K] {
    const el = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
}

// Build a zero-size <svg> holding the displacement filter:
// fractal noise (slowly animated) -> softened -> displaces the backdrop.
export function createDisplacementFilter(
    options: DisplacementFilterOptions = {},
    doc: Document = document
): SVGSVGElement {
    const {
        scale = DEFAULT_DISTORTION_SCALE,
        speed = DEFAULT_DISTORTION_SPEED,
        animate = true,
    } = options;

    // Zero-size rather than display:none, which would disable the filter.
    const svg = svgEl(doc, 'svg', {
        width: '0',
        height: '0',
        'aria-hidden': 'true',
        focusable: 'false',
        style: 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none',
    });

    const filter = svgEl(doc, 'filter', {
        id: filterIdFor(scale, speed),
        'color-interpolation-filters': 'sRGB',
    });

    const noise = svgEl(doc, 'feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: '0.010 0.012',
        numOctaves: '2',
        seed: '3',
        result: 'noise',
    });

    if (animate) {
        noise.appendChild(
            svgEl(doc, 'animate', {
                attributeName: 'baseFrequency',
                values: '0.010 0.012; 0.014 0.009; 0.010 0.012',
                dur: `${speed}s`,
                repeatCount: 'indefinite',
            })
        );
    }

    const soften = svgEl(doc, 'feGaussianBlur', {
        in: 'noise',
        stdDeviation: '2',
        result: 'softNoise',
    });

    const displace = svgEl(doc, 'feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'softNoise',
        scale: String(scale),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
    });

    filter.append(noise, soften, displace);
    svg.appendChild(filter);
    return svg;
}

// Make sure the filter for these options exists in the document, adding it
// if needed. Safe to call repeatedly. Returns the filter id.
export function ensureDisplacementFilter(
    options: DisplacementFilterOptions = {},
    doc: Document = document
): string {
    const id = filterIdFor(options.scale, options.speed);
    if (!doc.getElementById(id)) {
        (doc.body ?? doc.documentElement).appendChild(createDisplacementFilter(options, doc));
    }
    return id;
}