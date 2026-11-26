// End-to-end check of the playground, in real Chromium.
//
// Starts its own dev server, then drives the page like a person would:
// drags the test button around, uploads images, uses the keyboard. At every
// stop it also compares the brightness the page reports with the brightness
// of the real pixels under the button (a screenshot with the content hidden).
//
// Run:  npm run test:playground   (needs: npm i -D playwright, npx playwright install chromium)

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOLERANCE = 0.05;
const shots = os.tmpdir(); // screenshots of the drag tests land here

const server = await createServer({
    root: path.join(here, '..'),
    logLevel: 'error',
    server: { port: 5188, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
};

// Runs in the page: mean relative luminance of a PNG given as base64.
async function luminanceOfPng(base64) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const lin = (v) => {
        const n = v / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
        total += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
    }
    return total / (data.length / 4);
}

async function newPage(viewport, options = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    await page.waitForSelector('#live');
    await page.waitForTimeout(400);
    return { page, context, errors };
}

// What the readout says about the test button right now.
async function readout(page) {
    return page.evaluate(() => {
        const live = document.getElementById('live');
        const text = document.getElementById('status-text').textContent ?? '';
        const brightness = /brightness ([0-9.]+)/.exec(text);
        return {
            textColor: live.style.getPropertyValue('--glass-text-color'),
            brightness: brightness ? Number(brightness[1]) : null,
            text,
        };
    });
}

// Drag the test button so its centre ends up at (x, y), in one smooth motion.
async function dragTo(page, x, y) {
    const box = await page.locator('#live').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(220);
}

// Brightness of the real pixels under the test button, with the content hidden.
async function truthUnderButton(page) {
    const box = await page.locator('#live').boundingBox();
    await page.evaluate(() => { document.getElementById('main').style.visibility = 'hidden'; });
    const png = await page.screenshot({
        clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    });
    await page.evaluate(() => { document.getElementById('main').style.visibility = 'visible'; });
    return page.evaluate(`(${luminanceOfPng.toString()})("${png.toString('base64')}")`);
}

async function compareToPixels(page, label) {
    const r = await readout(page);
    const truth = await truthUnderButton(page);
    const diff = r.brightness === null ? 1 : Math.abs(r.brightness - truth);
    check(`${label}: reported brightness matches the real pixels`, diff <= TOLERANCE, `page ${r.brightness}, pixels ${truth.toFixed(3)}`);
    return r;
}

const LIGHT = 'rgb(245, 245, 245)';
const toMode = (color) => (color === '#f5f5f5' ? 'light' : 'dark');

// ---------------------------------------------------------------------------
// 1. Layout
// ---------------------------------------------------------------------------
{
    const { page, context, errors } = await newPage({ width: 1280, height: 800 });
    const m = await page.evaluate(() => {
        const r = document.querySelector('.panel').getBoundingClientRect();
        return { right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    check('panel is flush with the right edge', m.right === m.vw, `right ${m.right} of ${m.vw}`);
    check('panel runs the full window height', m.top === 0 && m.bottom === m.vh, `${m.top}..${m.bottom} of ${m.vh}`);

    // every background loads without errors
    const options = await page.$$eval('#bg option', (o) => o.map((x) => x.value));
    for (const value of options) {
        await page.selectOption('#bg', value);
        await page.waitForTimeout(250);
    }
    check('all backgrounds load without errors', errors.length === 0, errors.join(' | '));
    await context.close();
}
{
    const { page, context } = await newPage({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check('no sideways scrolling on a phone', !overflow);
    await context.close();
}

// ---------------------------------------------------------------------------
// 2. Dragging over the animated blobs (still, so positions are repeatable)
// ---------------------------------------------------------------------------
{
    const { page, context, errors } = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
    await page.selectOption('#bg', 'blobs');
    await page.waitForTimeout(300);

    const seen = { light: 0, dark: 0 };
    // (604, 476) is the bright cyan highlight; the rest are dim or in between.
    const stops = [[90, 560], [300, 600], [520, 420], [604, 476], [640, 300], [760, 560], [820, 150], [150, 140], [700, 700]];
    for (const [x, y] of stops) {
        await dragTo(page, x, y);
        const r = await compareToPixels(page, `blobs at ${x},${y}`);
        seen[toMode(r.textColor)]++;
    }
    check('dragging over the blobs uses both light and dark text', seen.light > 0 && seen.dark > 0, JSON.stringify(seen));
    await page.screenshot({ path: path.join(shots, 'glassware-blobs-drag.png') });

    // the text follows brightness: dark text only on bright spots
    await dragTo(page, 604, 476);
    const bright = await readout(page);
    await dragTo(page, 60, 700);
    const dim = await readout(page);
    check('text flips between a bright and a dim spot', toMode(bright.textColor) !== toMode(dim.textColor), `${bright.textColor} (${bright.brightness}) vs ${dim.textColor} (${dim.brightness})`);

    // the button cannot be dragged under the panel or out of the window
    await dragTo(page, 1270, 790);
    const edge = await page.evaluate(() => {
        const b = document.getElementById('live').getBoundingClientRect();
        const m = document.getElementById('main').getBoundingClientRect();
        return { right: b.right, bottom: b.bottom, mainRight: m.right, mainBottom: m.bottom };
    });
    check('the button stays inside the content area', edge.right <= edge.mainRight && edge.bottom <= edge.mainBottom, JSON.stringify(edge));

    // keyboard and double-click
    await page.focus('#live');
    const before = await page.evaluate(() => document.getElementById('live').style.translate);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const after = await page.evaluate(() => document.getElementById('live').style.translate);
    check('arrow keys move the button', before !== after, `${before} -> ${after}`);
    await page.dblclick('#live');
    const reset = await page.evaluate(() => document.getElementById('live').style.translate);
    check('double-click puts the button back', /^0px( 0px)?$/.test(reset), reset);

    check('no errors while dragging over blobs', errors.length === 0, errors.join(' | '));
    await context.close();
}

// ---------------------------------------------------------------------------
// 3. Uploading an image: left half black, right half white
// ---------------------------------------------------------------------------
{
    const { page, context, errors } = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });

    const dataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#000';
        x.fillRect(0, 0, 200, 300);
        x.fillStyle = '#fff';
        x.fillRect(200, 0, 200, 300);
        return c.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await page.setInputFiles('#file', { name: 'half.png', mimeType: 'image/png', buffer });
    await page.waitForFunction(() => document.getElementById('bg').value === 'upload');
    await page.waitForTimeout(400);

    const note = await page.textContent('#upload-note');
    check('the upload is acknowledged', /half\.png/.test(note ?? ''), note ?? '');
    const hasImage = await page.evaluate(() => getComputedStyle(document.getElementById('stage')).backgroundImage.startsWith('url('));
    check('the uploaded image becomes the background', hasImage);

    await dragTo(page, 150, 500);
    const onBlack = await compareToPixels(page, 'upload, black half');
    check('upload: light text on the black half', toMode(onBlack.textColor) === 'light', onBlack.text);

    await dragTo(page, 800, 500);
    const onWhite = await compareToPixels(page, 'upload, white half');
    check('upload: dark text on the white half', toMode(onWhite.textColor) === 'dark', onWhite.text);
    await page.screenshot({ path: path.join(shots, 'glassware-upload-drag.png') });

    // the page's own text picks a tone too: a half-and-half image averages near the middle, so only check it is set
    const tone = await page.evaluate(() => document.getElementById('stage').dataset.tone);
    check('page text tone is chosen for the upload', tone === 'light' || tone === 'dark', String(tone));

    // not an image: refused, and the current background stays
    await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForTimeout(200);
    const refused = await page.evaluate(() => ({
        error: document.getElementById('upload-note').classList.contains('error'),
        bg: document.getElementById('bg').value,
    }));
    check('a non-image file is refused with a message', refused.error && refused.bg === 'upload', JSON.stringify(refused));

    // a file that claims to be an image but is not
    await page.setInputFiles('#file', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
    await page.waitForTimeout(400);
    const broken = await page.evaluate(() => document.getElementById('upload-note').classList.contains('error'));
    check('a broken image is refused with a message', broken);

    check('no errors while uploading', errors.length === 0, errors.join(' | '));
    await context.close();
}

// ---------------------------------------------------------------------------
// 4. Sunset halo: bright everywhere, text stays dark, readout matches pixels
// ---------------------------------------------------------------------------
{
    const { page, context, errors } = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
    await page.selectOption('#bg', 'sunset');
    await page.waitForTimeout(300);
    for (const [x, y] of [[120, 120], [470, 360], [700, 640]]) {
        await dragTo(page, x, y);
        const r = await compareToPixels(page, `sunset at ${x},${y}`);
        check(`sunset at ${x},${y}: dark text`, toMode(r.textColor) === 'dark', r.text);
    }
    check('no errors on the sunset background', errors.length === 0, errors.join(' | '));
    await context.close();
}

// ---------------------------------------------------------------------------
// 5. Animated blobs really animate, and the text keeps up
// ---------------------------------------------------------------------------
{
    const { page, context } = await newPage({ width: 1280, height: 800 });
    await page.selectOption('#bg', 'blobs');
    const pixel = () => page.evaluate(() => {
        const c = document.getElementById('blobs');
        return Array.from(c.getContext('2d', { willReadFrequently: true }).getImageData(400, 300, 1, 1).data).join(',');
    });
    const first = await pixel();
    await page.waitForTimeout(2500);
    const second = await pixel();
    check('the blobs move on their own', first !== second, `${first} -> ${second}`);
    await context.close();
}

await browser.close();
await server.close();

// ---------------------------------------------------------------------------
let failed = 0;
for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${!r.ok || r.detail.length > 0 && !r.ok ? `  [${r.detail}]` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed (screenshots in ${shots})`);
process.exit(failed === 0 ? 0 : 1);