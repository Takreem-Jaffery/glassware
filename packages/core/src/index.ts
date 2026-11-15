import { resolveConfig, type GlassConfig, type ResolvedConfig } from './config';
import { resolveContrastMode, type PixelReader } from './sampling';
import { TEXT_COLORS } from './visual';
import {
    DEFAULT_DISTORTION_SCALE,
    DEFAULT_DISTORTION_SPEED,
    ensureDisplacementFilter,
    supportsWateryGlass,
} from './watery';

export { resolveConfig, RANGES } from './config';
export type { GlassConfig, GlassType, ResolvedConfig } from './config';
export { resolveContrastMode } from './sampling';
export type { PixelReader } from './sampling';
export { supportsWateryGlass } from './watery';

export interface AttachOptions {
    // Replaces the canvas image reader, e.g. to read through your own
    // CORS-enabled proxy. Must resolve RGBA pixel data, or null on failure.
    readPixels?: PixelReader;
}

export interface GlassHandle {
    readonly element: HTMLElement;
    // The validated config currently applied (only keys you set).
    readonly config: ResolvedConfig;
    // Resolves once the text color for the latest config has been decided.
    // Everything else is applied synchronously, before attach() returns.
    readonly ready: Promise<void>;
    // Merge new settings over the current ones. Keys you leave out keep their
    // value; pass undefined for a key to go back to its default.
    update(config: GlassConfig): Promise<void>;
    // Re-measure the background and pick the text color again, e.g. after the
    // page behind the element changed.
    refresh(): Promise<void>;
    // Remove everything attach() added and restore what was there before.
    detach(): void;
}

// Inline custom properties and attributes attach() may write. The values
// found on the element beforehand are saved so detach() can put them back.
const MANAGED_PROPS = [
    '--glass-blur',
    '--glass-transparency',
    '--glass-tint',
    '--glass-radius',
    '--glass-distortion-scale',
    '--glass-distortion-speed',
    '--glass-distortion-filter',
    '--glass-text-color',
] as const;

const MANAGED_ATTRS = ['data-glass-type', 'data-glass-edge'] as const;

const registry = new WeakMap<Element, GlassHandle>();

function assertElement(el: unknown): asserts el is HTMLElement {
    const node = el as Node | null;
    if (!node || typeof node !== 'object' || node.nodeType !== 1 || !('style' in node)) {
        throw new TypeError('glassware.attach: expected an HTMLElement');
    }
}

function prefersReducedMotion(doc: Document): boolean {
    try {
        const view = doc.defaultView;
        return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

export function attach(
    element: HTMLElement,
    config: GlassConfig = {},
    options: AttachOptions = {}
): GlassHandle {
    assertElement(element);

    // Attaching twice is the same as updating.
    const existing = registry.get(element);
    if (existing) {
        void existing.update(config);
        return existing;
    }

    const el = element;
    const doc = el.ownerDocument;

    const hadClass = el.classList.contains('glass');
    const savedProps = new Map<string, string>(
        MANAGED_PROPS.map((name) => [name, el.style.getPropertyValue(name)])
    );
    const savedAttrs = new Map<string, string | null>(
        MANAGED_ATTRS.map((name) => [name, el.getAttribute(name)])
    );

    let current: GlassConfig = { ...resolveConfig(config) };
    let detached = false;
    let token = 0; // bumped for every contrast run so stale results are ignored
    let pending: Promise<void> = Promise.resolve();

    // Write a property, or put back what was there before attach() when null.
    function setProp(name: (typeof MANAGED_PROPS)[number], value: string | null): void {
        const fallback = savedProps.get(name) ?? '';
        if (value !== null) el.style.setProperty(name, value);
        else if (fallback) el.style.setProperty(name, fallback);
        else el.style.removeProperty(name);
    }

    function setAttr(name: (typeof MANAGED_ATTRS)[number], value: string | null): void {
        if (value !== null) el.setAttribute(name, value);
        else el.removeAttribute(name);
    }

    function restoreAttr(name: (typeof MANAGED_ATTRS)[number]): void {
        setAttr(name, savedAttrs.get(name) ?? null);
    }

    function applyStyles(): void {
        const c = current;
        setProp('--glass-blur', c.blur !== undefined ? `${c.blur}px` : null);
        setProp('--glass-transparency', c.transparency !== undefined ? String(c.transparency) : null);
        setProp('--glass-tint', c.tint ?? null);
        setProp('--glass-radius', c.radius !== undefined ? `${c.radius}px` : null);
        setProp(
            '--glass-distortion-scale',
            c.distortionScale !== undefined ? String(c.distortionScale) : null
        );
        setProp(
            '--glass-distortion-speed',
            c.distortionSpeed !== undefined ? `${c.distortionSpeed}s` : null
        );

        // SPEC §3: edgeReflection false -> data-glass-edge="off".
        // Left alone when the developer didn't set it.
        if (c.edgeReflection === false) setAttr('data-glass-edge', 'off');
        else if (c.edgeReflection === true) setAttr('data-glass-edge', null);
        else restoreAttr('data-glass-edge');

        // SPEC §1: watery only when it was asked for AND the browser supports
        // it AND the filter exists. Anything else renders frosted. The library
        // owns this attribute while attached, because watery without its
        // filter would leave the element with no blur at all.
        if (c.type === 'watery' && supportsWateryGlass()) {
            const id = ensureDisplacementFilter(
                {
                    scale: c.distortionScale ?? DEFAULT_DISTORTION_SCALE,
                    speed: c.distortionSpeed ?? DEFAULT_DISTORTION_SPEED,
                    animate: !prefersReducedMotion(doc),
                },
                doc
            );
            setProp('--glass-distortion-filter', `url(#${id})`);
            setAttr('data-glass-type', 'watery');
        } else {
            setProp('--glass-distortion-filter', null);
            setAttr('data-glass-type', null);
        }
    }

    function resolveContrast(): Promise<void> {
        const mine = ++token;
        pending = resolveContrastMode(el, {
            contrastMode: current.contrastMode,
            deps: { readPixels: options.readPixels },
        }).then(
            (mode) => {
                if (detached || mine !== token) return;
                el.style.setProperty('--glass-text-color', TEXT_COLORS[mode]);
            },
            () => {
                // A failed measurement leaves the CSS default text color in place.
            }
        );
        return pending;
    }

    const handle: GlassHandle = {
        element: el,
        get config() {
            return current;
        },
        get ready() {
            return pending;
        },
        update(next) {
            if (detached) return Promise.resolve();
            const merged: Record<string, unknown> = { ...current, ...resolveConfig(next) };
            // An explicit undefined means "back to the default".
            if (next && typeof next === 'object') {
                for (const [key, value] of Object.entries(next)) {
                    if (value === undefined) delete merged[key];
                }
            }
            current = merged as GlassConfig;
            applyStyles();
            return resolveContrast();
        },
        refresh() {
            return detached ? Promise.resolve() : resolveContrast();
        },
        detach() {
            if (detached) return;
            detached = true;
            token++;
            for (const name of MANAGED_PROPS) setProp(name, null);
            for (const name of MANAGED_ATTRS) restoreAttr(name);
            if (!hadClass) el.classList.remove('glass');
            registry.delete(el);
        },
    };

    el.classList.add('glass');
    applyStyles();
    registry.set(el, handle);
    resolveContrast();

    return handle;
}