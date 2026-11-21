// Parse and evaluate CSS gradients, so the color at any point inside a
// gradient background can be computed without rendering it.
//
// Supported: linear-gradient and radial-gradient, plain or repeating, with
// angles or "to <side/corner>", circle/ellipse sizes and positions, and
// color stops given as hex, rgb(), rgba() or "transparent" (browsers report
// every color as rgb()/rgba() in computed styles). Anything else returns
// null and the caller falls back to a rougher estimate.
//
// Not supported: conic gradients, color hints (a bare "30%" between stops),
// calc(), and non-px/% units.

import { parseColor, type RGBA } from './visual';

export interface Length {
    value: number;
    unit: 'px' | '%';
}

interface ColorStop {
    color: RGBA;
    position: Length | null;
}

export type RadialExtent = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';

export interface LinearGradient {
    kind: 'linear';
    repeating: boolean;
    // An angle in degrees (0 = to top, 90 = to right), or a corner:
    // x is +1 for right and -1 for left, y is +1 for bottom and -1 for top.
    direction: { type: 'angle'; deg: number } | { type: 'corner'; x: 1 | -1; y: 1 | -1 };
    stops: ColorStop[];
}

export interface RadialGradient {
    kind: 'radial';
    repeating: boolean;
    shape: 'circle' | 'ellipse';
    size: { type: 'extent'; extent: RadialExtent } | { type: 'explicit'; x: Length; y: Length | null };
    at: { x: Length; y: Length };
    stops: ColorStop[];
}

export type Gradient = LinearGradient | RadialGradient;

// Returns the color at a point, in the gradient's own box (0,0 = top left).
export type Painter = (x: number, y: number) => RGBA;

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

// Split on commas or whitespace, but not inside parentheses or quotes, so
// "rgb(1, 2, 3) 20%" stays two tokens and a data: URL stays whole.
export function splitTopLevel(input: string, separator: ',' | 'space'): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = '';

    const flush = () => {
        const trimmed = current.trim();
        if (trimmed) parts.push(trimmed);
        current = '';
    };

    for (const ch of input) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);

        const isSeparator = separator === ',' ? ch === ',' : /\s/.test(ch);
        if (depth === 0 && isSeparator) {
            flush();
            continue;
        }
        current += ch;
    }
    flush();
    return parts;
}

// "12px", "50%" or a bare 0. Other units (em, vw, calc()) are not supported.
export function parseLength(token: string): Length | null {
    const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|%)?$/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!match[2]) return value === 0 ? { value: 0, unit: 'px' } : null;
    return { value, unit: match[2].toLowerCase() as 'px' | '%' };
}

function parseAngle(token: string): number | null {
    const match = token.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    switch ((match[2] ?? 'deg').toLowerCase()) {
        case 'deg':
            return value;
        case 'grad':
            return value * 0.9;
        case 'rad':
            return (value * 180) / Math.PI;
        case 'turn':
            return value * 360;
        default:
            return null;
    }
}

const POSITION_KEYWORDS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

function axisValue(token: string, allowed: string[]): Length | null {
    if (allowed.includes(token)) return { value: POSITION_KEYWORDS[token], unit: '%' };
    return parseLength(token);
}

// One or two position tokens, in "x y" order or with keywords swapped
// ("top left"). Returns null for the 3- and 4-value forms.
export function parsePositionTokens(tokens: string[]): { x: Length; y: Length } | null {
    if (tokens.length < 1 || tokens.length > 2) return null;
    const lower = tokens.map((t) => t.toLowerCase());
    let xToken = lower[0];
    let yToken = lower[1] ?? 'center';

    if (lower.length === 1 && (xToken === 'top' || xToken === 'bottom')) {
        yToken = xToken;
        xToken = 'center';
    } else if (xToken === 'top' || xToken === 'bottom' || yToken === 'left' || yToken === 'right') {
        [xToken, yToken] = [yToken, xToken];
    }

    const x = axisValue(xToken, ['left', 'center', 'right']);
    const y = axisValue(yToken, ['top', 'center', 'bottom']);
    return x && y ? { x, y } : null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseStops(args: string[]): ColorStop[] | null {
    const stops: ColorStop[] = [];
    for (const arg of args) {
        const tokens = splitTopLevel(arg, 'space');
        if (tokens.length === 0 || tokens.length > 3) return null;

        const color = parseColor(tokens[0]);
        if (!color) return null; // unknown color syntax, or a color hint

        const positions: Length[] = [];
        for (const token of tokens.slice(1)) {
            const length = parseLength(token);
            if (!length) return null;
            positions.push(length);
        }

        if (positions.length === 0) stops.push({ color, position: null });
        else for (const position of positions) stops.push({ color, position });
    }
    return stops.length >= 2 ? stops : null;
}

function parseLinearDirection(first: string): LinearGradient['direction'] | null {
    const words = first.toLowerCase().slice(3).split(/\s+/).filter(Boolean);
    if (words.length === 0 || !words.every((w) => ['top', 'bottom', 'left', 'right'].includes(w))) {
        return null;
    }
    const vertical = words.includes('top') ? -1 : words.includes('bottom') ? 1 : 0;
    const horizontal = words.includes('left') ? -1 : words.includes('right') ? 1 : 0;

    if (words.length === 1) {
        if (vertical === -1) return { type: 'angle', deg: 0 };
        if (vertical === 1) return { type: 'angle', deg: 180 };
        if (horizontal === 1) return { type: 'angle', deg: 90 };
        return { type: 'angle', deg: 270 };
    }
    if (words.length === 2 && vertical !== 0 && horizontal !== 0) {
        return { type: 'corner', x: horizontal as 1 | -1, y: vertical as 1 | -1 };
    }
    return null;
}

function parseLinear(args: string[], repeating: boolean): LinearGradient | null {
    let direction: LinearGradient['direction'] = { type: 'angle', deg: 180 }; // default: to bottom
    let rest = args;

    if (args[0].toLowerCase().startsWith('to ')) {
        const parsed = parseLinearDirection(args[0]);
        if (!parsed) return null;
        direction = parsed;
        rest = args.slice(1);
    } else {
        const deg = parseAngle(args[0]);
        if (deg !== null) {
            direction = { type: 'angle', deg };
            rest = args.slice(1);
        }
    }

    const stops = parseStops(rest);
    return stops ? { kind: 'linear', repeating, direction, stops } : null;
}

const EXTENTS = new Set<string>(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner']);

function parseRadial(args: string[], repeating: boolean): RadialGradient | null {
    let shape: 'circle' | 'ellipse' | null = null;
    let size: RadialGradient['size'] | null = null;
    let at: RadialGradient['at'] = { x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' } };
    let rest = args;

    // The first argument is either a color stop or the shape/size/position part.
    const firstTokens = splitTopLevel(args[0], 'space');
    if (parseColor(firstTokens[0]) === null) {
        rest = args.slice(1);

        const lengths: Length[] = [];
        let index = 0;
        for (; index < firstTokens.length; index++) {
            const token = firstTokens[index].toLowerCase();
            if (token === 'circle' || token === 'ellipse') shape = token;
            else if (EXTENTS.has(token)) size = { type: 'extent', extent: token as RadialExtent };
            else if (token === 'at') break;
            else {
                const length = parseLength(token);
                if (!length) return null;
                lengths.push(length);
            }
        }

        if (index < firstTokens.length) {
            const position = parsePositionTokens(firstTokens.slice(index + 1));
            if (!position) return null;
            at = position;
        }

        if (lengths.length > 0) {
            if (size) return null;
            if (lengths.length === 1) {
                if (shape === 'ellipse' || lengths[0].unit === '%') return null;
                shape = 'circle';
                size = { type: 'explicit', x: lengths[0], y: null };
            } else if (lengths.length === 2) {
                if (shape === 'circle') return null;
                shape = 'ellipse';
                size = { type: 'explicit', x: lengths[0], y: lengths[1] };
            } else {
                return null;
            }
        }
    }

    const stops = parseStops(rest);
    if (!stops) return null;

    return {
        kind: 'radial',
        repeating,
        shape: shape ?? 'ellipse',
        size: size ?? { type: 'extent', extent: 'farthest-corner' },
        at,
        stops,
    };
}

// Parse one gradient, e.g. "linear-gradient(90deg, #000, #fff)".
// Returns null for anything unsupported.
export function parseGradient(value: string): Gradient | null {
    const match = value.trim().match(/^(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)$/i);
    if (!match) return null;

    const args = splitTopLevel(match[3], ',');
    if (args.length < 2) return null;

    const repeating = Boolean(match[1]);
    return match[2].toLowerCase() === 'linear' ? parseLinear(args, repeating) : parseRadial(args, repeating);
}

// ---------------------------------------------------------------------------
// Evaluating
// ---------------------------------------------------------------------------

interface ResolvedStop {
    pos: number; // fraction of the gradient line (or radius)
    color: RGBA;
}

// Turn stop positions into fractions and fill in the gaps, following the
// CSS rules: the first stop defaults to 0 and the last to 1, a stop can't
// sit before an earlier one, and unpositioned stops are spread evenly.
function resolveStops(stops: ColorStop[], axisLength: number): ResolvedStop[] {
    const count = stops.length;
    const pos: Array<number | null> = stops.map((stop) => {
        if (stop.position === null) return null;
        if (stop.position.unit === '%') return stop.position.value / 100;
        return axisLength > 0 ? stop.position.value / axisLength : 0;
    });

    if (pos[0] === null) pos[0] = 0;
    if (pos[count - 1] === null) pos[count - 1] = 1;

    let highest = -Infinity;
    for (let i = 0; i < count; i++) {
        const value = pos[i];
        if (value === null) continue;
        if (value < highest) pos[i] = highest;
        else highest = value;
    }

    let i = 0;
    while (i < count) {
        if (pos[i] !== null) {
            i++;
            continue;
        }
        let j = i;
        while (pos[j] === null) j++;
        const start = pos[i - 1] as number;
        const end = pos[j] as number;
        for (let k = i; k < j; k++) {
            pos[k] = start + ((end - start) * (k - i + 1)) / (j - i + 1);
        }
        i = j;
    }

    return stops.map((stop, index) => ({ pos: pos[index] as number, color: stop.color }));
}

// CSS interpolates between stops in premultiplied alpha, so fading to
// "transparent" doesn't pass through gray.
function mix(a: RGBA, b: RGBA, fraction: number): RGBA {
    const alpha = a.a + (b.a - a.a) * fraction;
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (ca: number, cb: number) =>
        (ca * a.a * (1 - fraction) + cb * b.a * fraction) / alpha;
    return { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha };
}

function colorAtPosition(stops: ResolvedStop[], position: number, repeating: boolean): RGBA {
    const first = stops[0].pos;
    const last = stops[stops.length - 1].pos;

    let t = position;
    if (repeating && last > first) {
        const period = last - first;
        t = first + ((((t - first) % period) + period) % period);
    }

    if (t <= first) return stops[0].color;
    if (t >= last) return stops[stops.length - 1].color;

    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (t < b.pos) return mix(a.color, b.color, (t - a.pos) / (b.pos - a.pos));
    }
    return stops[stops.length - 1].color;
}

function resolveLength(length: Length, total: number): number {
    return length.unit === '%' ? (total * length.value) / 100 : length.value;
}

function linearPainter(gradient: LinearGradient, width: number, height: number): Painter {
    let dx: number;
    let dy: number;

    if (gradient.direction.type === 'angle') {
        const radians = (gradient.direction.deg * Math.PI) / 180;
        dx = Math.sin(radians);
        dy = -Math.cos(radians);
    } else {
        // "to top right" and friends: the 50% line runs through the two
        // other corners, so the direction is perpendicular to that diagonal.
        const vx = gradient.direction.x * height;
        const vy = gradient.direction.y * width;
        const length = Math.hypot(vx, vy) || 1;
        dx = vx / length;
        dy = vy / length;
    }

    const lineLength = Math.abs(width * dx) + Math.abs(height * dy);
    const stops = resolveStops(gradient.stops, lineLength);
    if (lineLength <= 0) return () => stops[0].color;

    return (x, y) => {
        const t = ((x - width / 2) * dx + (y - height / 2) * dy) / lineLength + 0.5;
        return colorAtPosition(stops, t, gradient.repeating);
    };
}

function radii(gradient: RadialGradient, width: number, height: number, cx: number, cy: number): [number, number] {
    const toLeft = Math.abs(cx);
    const toRight = Math.abs(width - cx);
    const toTop = Math.abs(cy);
    const toBottom = Math.abs(height - cy);
    const circle = gradient.shape === 'circle';

    if (gradient.size.type === 'explicit') {
        const rx = resolveLength(gradient.size.x, width);
        const ry = gradient.size.y ? resolveLength(gradient.size.y, height) : rx;
        return [rx, ry];
    }

    switch (gradient.size.extent) {
        case 'closest-side': {
            const rx = Math.min(toLeft, toRight);
            const ry = Math.min(toTop, toBottom);
            const r = Math.min(rx, ry);
            return circle ? [r, r] : [rx, ry];
        }
        case 'farthest-side': {
            const rx = Math.max(toLeft, toRight);
            const ry = Math.max(toTop, toBottom);
            const r = Math.max(rx, ry);
            return circle ? [r, r] : [rx, ry];
        }
        case 'closest-corner': {
            const rx = Math.min(toLeft, toRight);
            const ry = Math.min(toTop, toBottom);
            const r = Math.hypot(rx, ry);
            return circle ? [r, r] : [rx * Math.SQRT2, ry * Math.SQRT2];
        }
        default: {
            // farthest-corner, the default
            const rx = Math.max(toLeft, toRight);
            const ry = Math.max(toTop, toBottom);
            const r = Math.hypot(rx, ry);
            return circle ? [r, r] : [rx * Math.SQRT2, ry * Math.SQRT2];
        }
    }
}

function radialPainter(gradient: RadialGradient, width: number, height: number): Painter {
    const cx = resolveLength(gradient.at.x, width);
    const cy = resolveLength(gradient.at.y, height);
    const [rx, ry] = radii(gradient, width, height, cx, cy);
    const stops = resolveStops(gradient.stops, rx);

    if (!(rx > 0) || !(ry > 0)) return () => stops[stops.length - 1].color;

    return (x, y) => {
        const t = Math.hypot((x - cx) / rx, (y - cy) / ry);
        return colorAtPosition(stops, t, gradient.repeating);
    };
}

// Build a function that returns the gradient's color at any point of a
// width x height box. Colors can be translucent (alpha below 1).
export function createGradientPainter(gradient: Gradient, width: number, height: number): Painter {
    return gradient.kind === 'linear'
        ? linearPainter(gradient, width, height)
        : radialPainter(gradient, width, height);
}

// A rough single color for a gradient that can't be parsed: the average of
// whatever #hex / rgb() / rgba() / transparent stops it contains.
export function looseGradientColor(css: string): RGBA | null {
    const withoutUrls = css.replace(/url\([^)]*\)/gi, '');
    const tokens = withoutUrls.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\btransparent\b/gi) ?? [];

    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    let count = 0;
    for (const token of tokens) {
        const color = parseColor(token);
        if (!color) continue;
        r += color.r * color.a;
        g += color.g * color.a;
        b += color.b * color.a;
        alpha += color.a;
        count++;
    }
    if (count === 0) return null;
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: r / alpha, g: g / alpha, b: b / alpha, a: alpha / count };
}