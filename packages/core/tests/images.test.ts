// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createImageStore, readImagePixels, toImagePixels, type PixelReader } from '../src/images';

describe('toImagePixels', () => {
    it('returns null for nothing and for too little data', () => {
        expect(toImagePixels(null)).toBeNull();
        expect(toImagePixels(undefined)).toBeNull();
        expect(toImagePixels([])).toBeNull();
        expect(toImagePixels([1, 2, 3])).toBeNull();
    });

    it('treats plain data as a square when the pixel count allows', () => {
        const data = new Array(16 * 16 * 4).fill(0);
        expect(toImagePixels(data)).toEqual({ width: 16, height: 16, data });
    });

    it('treats plain data of another size as a single row', () => {
        const data = [0, 0, 0, 255, 255, 255, 255, 255];
        expect(toImagePixels(data)).toEqual({ width: 2, height: 1, data });
    });

    it('accepts typed arrays', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        expect(toImagePixels(data)).toMatchObject({ width: 4, height: 4 });
    });

    it('passes a valid { width, height, data } through, with natural size', () => {
        const pixels = { width: 2, height: 1, data: [0, 0, 0, 255, 1, 1, 1, 255], naturalWidth: 800, naturalHeight: 400 };
        expect(toImagePixels(pixels)).toBe(pixels);
    });

    it('rejects an ImageData-like object whose data is too short', () => {
        expect(toImagePixels({ width: 4, height: 4, data: [0, 0, 0, 0] })).toBeNull();
        expect(toImagePixels({ width: 0, height: 4, data: [] })).toBeNull();
    });
});

describe('createImageStore', () => {
    const ok = [0, 0, 0, 255];

    it('reads an image once and shares the result', async () => {
        const reader = vi.fn(async () => ok);
        const store = createImageStore(reader);
        const [a, b] = await Promise.all([store.get('a.png'), store.get('a.png')]);
        await store.get('a.png');
        expect(reader).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(a).toMatchObject({ width: 1, height: 1 });
    });

    it('reads different urls separately', async () => {
        const reader = vi.fn(async () => ok);
        const store = createImageStore(reader);
        await store.get('a.png');
        await store.get('b.png');
        expect(reader).toHaveBeenCalledTimes(2);
    });

    it('remembers a failure for a while, then tries again', async () => {
        let time = 1000;
        const reader = vi.fn<PixelReader>(async () => null);
        const store = createImageStore(reader, () => time);

        expect(await store.get('a.png')).toBeNull();
        time += 5000;
        expect(await store.get('a.png')).toBeNull();
        expect(reader).toHaveBeenCalledTimes(1); // still remembered

        time += 6000; // past the retry window
        await store.get('a.png');
        expect(reader).toHaveBeenCalledTimes(2);
    });

    it('treats a reader that throws as a failure', async () => {
        const store = createImageStore(async () => {
            throw new Error('boom');
        });
        expect(await store.get('a.png')).toBeNull();
    });

    it('forgets the oldest images when it grows too big', async () => {
        const reader = vi.fn(async () => ok);
        const store = createImageStore(reader);
        for (let i = 0; i < 30; i++) await store.get(`img-${i}.png`);
        expect(reader).toHaveBeenCalledTimes(30);

        await store.get('img-29.png'); // recent: still cached
        expect(reader).toHaveBeenCalledTimes(30);
        await store.get('img-0.png'); // oldest: dropped
        expect(reader).toHaveBeenCalledTimes(31);
    });

    it('clear() empties the cache', async () => {
        const reader = vi.fn(async () => ok);
        const store = createImageStore(reader);
        await store.get('a.png');
        store.clear();
        await store.get('a.png');
        expect(reader).toHaveBeenCalledTimes(2);
    });
});

describe('readImagePixels', () => {
    it('resolves null instead of hanging when the image never loads', async () => {
        // jsdom never loads images, which mimics a stalled request.
        expect(await readImagePixels('photo.png', 256, 50)).toBeNull();
    });
});