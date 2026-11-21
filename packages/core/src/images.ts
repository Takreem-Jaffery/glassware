// Loading images as raw pixels, with a cache.
//
// Region sampling needs an image's pixels again and again (every time the
// element moves), so each image is decoded once, at a reduced size, and the
// result is kept.

export interface ImagePixels {
    width: number; // pixels in `data`, which may be a reduced copy of the image
    height: number;
    data: ArrayLike<number>; // RGBA, 4 values per pixel, row by row
    // The image's real size in CSS pixels. background-size: auto and
    // background-repeat depend on it. Defaults to width/height.
    naturalWidth?: number;
    naturalHeight?: number;
}

// Reads an image's pixels. Either shape is accepted so existing readers keep
// working: plain RGBA data is treated as a square when the pixel count is a
// perfect square, and as a single row otherwise.
export type PixelReader = (url: string) => Promise<ArrayLike<number> | ImagePixels | null>;

export function toImagePixels(result: ArrayLike<number> | ImagePixels | null | undefined): ImagePixels | null {
    if (!result) return null;

    const asPixels = result as ImagePixels;
    if (!Array.isArray(result) && typeof asPixels.width === 'number' && 'data' in asPixels) {
        const { width, height, data } = asPixels;
        const valid = width > 0 && height > 0 && data && data.length >= width * height * 4;
        return valid ? asPixels : null;
    }

    const data = result as ArrayLike<number>;
    const count = Math.floor(data.length / 4);
    if (count < 1) return null;
    const side = Math.round(Math.sqrt(count));
    return side * side === count
        ? { width: side, height: side, data }
        : { width: count, height: 1, data };
}

export interface ImageStore {
    get(url: string): Promise<ImagePixels | null>;
    clear(): void;
}

const RETRY_FAILED_AFTER_MS = 10_000;
const MAX_ENTRIES = 24;

// A cache in front of a reader. Concurrent requests for one url share a
// single read. A failed read is remembered for a few seconds, so an image
// that can't be read (blocked by CORS, say) isn't fetched again on every
// frame, but is retried later in case it was a hiccup.
export function createImageStore(reader: PixelReader, now: () => number = Date.now): ImageStore {
    interface Entry {
        promise: Promise<ImagePixels | null>;
        failedAt: number | null;
    }
    const cache = new Map<string, Entry>();

    return {
        get(url) {
            const existing = cache.get(url);
            if (existing && (existing.failedAt === null || now() - existing.failedAt < RETRY_FAILED_AFTER_MS)) {
                cache.delete(url); // most recently used goes last
                cache.set(url, existing);
                return existing.promise;
            }

            const entry: Entry = { promise: Promise.resolve(null), failedAt: null };
            entry.promise = (async () => {
                try {
                    return toImagePixels(await reader(url));
                } catch {
                    return null;
                }
            })().then((pixels) => {
                if (!pixels) entry.failedAt = now();
                return pixels;
            });

            cache.delete(url);
            cache.set(url, entry);
            while (cache.size > MAX_ENTRIES) {
                cache.delete(cache.keys().next().value as string);
            }
            return entry.promise;
        },
        clear() {
            cache.clear();
        },
    };
}

// The default reader: load the image with CORS enabled, draw it onto a
// canvas at no more than `maxDimension` on its long side, and read the
// pixels back. Resolves null on any failure, including the SecurityError a
// cross-origin image without CORS headers causes, and on a stalled load.
export function readImagePixels(
    url: string,
    maxDimension = 256,
    timeoutMs = 8000
): Promise<ImagePixels | null> {
    return new Promise((resolve) => {
        if (typeof Image === 'undefined' || typeof document === 'undefined') {
            resolve(null);
            return;
        }

        const timer = setTimeout(() => resolve(null), timeoutMs);
        const finish = (value: ImagePixels | null) => {
            clearTimeout(timer);
            resolve(value);
        };

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const naturalWidth = img.naturalWidth;
                const naturalHeight = img.naturalHeight;
                if (!naturalWidth || !naturalHeight) {
                    finish(null);
                    return;
                }
                const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
                const width = Math.max(1, Math.round(naturalWidth * scale));
                const height = Math.max(1, Math.round(naturalHeight * scale));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    finish(null);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                finish({ width, height, data: ctx.getImageData(0, 0, width, height).data, naturalWidth, naturalHeight });
            } catch {
                finish(null); // tainted canvas, etc.
            }
        };
        img.onerror = () => finish(null);
        img.src = url;
    });
}

const defaultStore = createImageStore(readImagePixels);
const customStores = new WeakMap<PixelReader, ImageStore>();

// The shared cache for the built-in reader, or a cache for a custom one.
export function getImageStore(reader?: PixelReader): ImageStore {
    if (!reader) return defaultStore;
    let store = customStores.get(reader);
    if (!store) {
        store = createImageStore(reader);
        customStores.set(reader, store);
    }
    return store;
}

// Forget every decoded image, e.g. if an image changed under the same URL.
export function clearImageCache(): void {
    defaultStore.clear();
}