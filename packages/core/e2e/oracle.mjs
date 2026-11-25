// Oracle test: does Glassware's idea of "how bright is it behind this
// element" match what a real browser actually paints?
//
// For each scenario this builds a page, then for several spots:
//   1. asks the library (measureBackground) for the luminance under the button
//   2. hides the button, screenshots exactly that rectangle, and averages the
//      real pixels. That number is the ground truth.
// The two must agree within TOLERANCE.
//
// Run:  npm run test:oracle     (needs: npm i -D playwright, npx playwright install chromium)

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOLERANCE = 0.05; // in luminance units, 0 to 1
const BUTTON = { w: 120, h: 44 };

// ---------------------------------------------------------------------------
// Scenarios. `css` styles the container; `spots` are button positions
// (viewport coordinates, top-left corner). `html` replaces the default page.
// IMG and TILE are data URLs made in the page, see setup() below.
// ---------------------------------------------------------------------------
const W = 800;
const H = 600;
const spots3 = [
    [20, 100],
    [340, 250],
    [660, 450],
];
const spots5 = [...spots3, [20, 500], [660, 20]];

const scenarios = [
    { name: 'linear gradient, left to right', css: 'background: linear-gradient(90deg, #000, #fff)', spots: spots5 },
    { name: 'linear gradient, 135deg, three colors', css: 'background: linear-gradient(135deg, #102a6b, #f4d35e 55%, #fff)', spots: spots5 },
    { name: 'linear gradient, to top right', css: 'background: linear-gradient(to top right, #000, #ffe0e0)', spots: spots5 },
    { name: 'radial gradient, closest-side', css: 'background: radial-gradient(circle closest-side at 30% 40%, #fff, #000)', spots: spots5 },
    { name: 'radial gradient, ellipse farthest-corner', css: 'background: radial-gradient(ellipse at 70% 60%, #ffd9a0, #1b1030)', spots: spots5 },
    { name: 'repeating linear gradient', css: 'background: repeating-linear-gradient(45deg, #000 0 20px, #fff 20px 60px)', spots: spots3 },
    { name: 'translucent stops over a color', css: 'background-color: #14213d; background-image: linear-gradient(90deg, transparent, rgba(255,255,255,0.9))', spots: spots5 },
    { name: 'two gradients stacked', css: 'background: linear-gradient(0deg, rgba(0,0,0,0.8), transparent 60%), linear-gradient(90deg, #ffd166, #ef476f)', spots: spots5 },

    { name: 'image, cover', css: 'background: url(IMG) center / cover no-repeat', spots: spots5 },
    { name: 'image, cover, positioned', css: 'background: url(IMG) 20% 80% / cover no-repeat', spots: spots5 },
    { name: 'image, contain, on a color', css: 'background: #222 url(IMG) center / contain no-repeat', spots: spots5 },
    { name: 'image, auto size, no-repeat', css: 'background: #eee url(IMG) 50px 60px no-repeat', spots: spots5 },
    { name: 'image, explicit px size, repeat', css: 'background: url(IMG) 0 0 / 200px 150px repeat', spots: spots5 },
    { name: 'small tile, repeat', css: 'background: url(TILE) repeat', spots: spots3 },
    { name: 'small tile, repeat-x', css: 'background: #888 url(TILE) 0 100px repeat-x', spots: spots5 },
    { name: 'image under a gradient', css: 'background: linear-gradient(90deg, rgba(0,0,0,0.7), transparent), url(IMG) center / cover', spots: spots5 },
    { name: 'image, fixed attachment', css: 'background: url(IMG) center / cover fixed', spots: spots5 },
    { name: 'image, background-origin: content-box', css: 'padding: 60px; background: #333 url(IMG) center / 50% 50% no-repeat; background-origin: content-box; background-clip: border-box', spots: spots5 },

    {
        name: 'translucent panel over a dark page',
        css: 'background: #000',
        inner: 'background: rgba(255,255,255,0.25); position:absolute; left:100px; top:80px; width:500px; height:380px',
        spots: [[150, 120], [420, 300], [20, 20], [680, 520]],
    },
    {
        name: 'gradient panel over a photo',
        css: 'background: url(IMG) center / cover',
        inner: 'background: linear-gradient(180deg, #000, rgba(0,0,0,0)); position:absolute; left:50px; top:50px; width:700px; height:500px',
        spots: [[100, 80], [340, 300], [600, 480], [20, 20]],
    },
    {
        name: 'page background on body only (propagates to the canvas)',
        body: 'background: linear-gradient(90deg, #000, #fff); margin: 0; height: 600px',
        container: false,
        spots: spots5,
    },
    {
        name: 'page background on html, body height shorter than the viewport',
        html: 'background: linear-gradient(180deg, #000, #fff)',
        body: 'margin: 0; height: 200px',
        container: false,
        spots: [[20, 20], [340, 300], [660, 520]],
    },
    {
        name: 'scroll container, background-attachment: local',
        css: 'overflow: auto; background: linear-gradient(180deg, #000, #fff) local; height: 400px; width: 600px; margin: 40px',
        content: '<div style="height:1200px"></div>',
        scrollTop: 300,
        spots: [[100, 60], [300, 200], [500, 380]],
    },
    {
        name: 'button nudged by a transform on the page',
        css: 'background: linear-gradient(90deg, #000, #fff)',
        buttonStyle: 'transform: translate(40px, 10px)',
        spots: spots3,
    },
];

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

// Runs in the page. Makes a 480 x 320 test picture (dark left, bright right,
// a mid-gray band, coloured blocks) and a 40 x 40 checker tile, as data URLs.
function makeImages() {
    const draw = (w, h, paint) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        paint(canvas.getContext('2d'), w, h);
        return canvas.toDataURL('image/png');
    };
    const IMG = draw(480, 320, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#05060a');
        g.addColorStop(0.5, '#7a7f8c');
        g.addColorStop(1, '#fdf6e3');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#d6336c';
        c.fillRect(30, 30, 120, 90);
        c.fillStyle = '#1c7ed6';
        c.fillRect(w - 170, h - 120, 130, 90);
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillRect(w / 2 - 40, 0, 80, h);
    });
    const TILE = draw(40, 40, (c) => {
        c.fillStyle = '#fff';
        c.fillRect(0, 0, 40, 40);
        c.fillStyle = '#111';
        c.fillRect(0, 0, 20, 20);
        c.fillRect(20, 20, 20, 20);
    });
    return { IMG, TILE };
}

// Runs in the page: mean relative luminance of a PNG, given as base64.
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

function pageHtml(scenario, urls) {
    const sub = (css = '') => css.replace(/url\(IMG\)/g, `url(${urls.IMG})`).replace(/url\(TILE\)/g, `url(${urls.TILE})`);
    const buttonHtml = `<button id="b" style="position:fixed; left:0; top:0; width:${BUTTON.w}px; height:${BUTTON.h}px; ${scenario.buttonStyle ?? ''}"></button>`;
    // The panel is an ancestor of the button: only ancestors are measured.
    const inside = scenario.inner ? `<div style="${sub(scenario.inner)}">${buttonHtml}</div>` : buttonHtml;
    const container =
        scenario.container === false
            ? buttonHtml
            : `<div id="stage" style="position:relative; width:${W}px; height:${H}px; ${sub(scenario.css)}">${scenario.content ?? ''}${inside}</div>`;
    const button = '';
    return `<!doctype html><html style="${sub(scenario.html)}"><head><style>
        html, body { margin: 0 } body { ${sub(scenario.body ?? '')} }
        * { transition: none !important; animation: none !important }
    </style></head><body>${container}${button}</body></html>`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const bundle = await build({
    entryPoints: [path.join(here, '../src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'Glassware',
    write: false,
    logLevel: 'error',
});
const libraryCode = bundle.outputFiles[0].text;

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
});
const page = await context.newPage();

const urls = await page.evaluate(`(${makeImages.toString()})()`);

let failures = 0;
let worst = 0;
const rows = [];

for (const scenario of scenarios) {
    await page.setContent(pageHtml(scenario, urls));
    await page.addScriptTag({ content: libraryCode });
    if (scenario.scrollTop) {
        await page.evaluate((top) => { document.getElementById('stage').scrollTop = top; }, scenario.scrollTop);
    }
    // Wait for the data URLs to decode, so images are ready like on a real page.
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));

    for (const [x, y] of scenario.spots) {
        // The button is position: fixed, so these are viewport coordinates.
        await page.evaluate(([px, py]) => {
            const b = document.getElementById('b');
            b.style.left = px + 'px';
            b.style.top = py + 'px';
        }, [x, y]);

        const measured = await page.evaluate(async () => {
            const result = await Glassware.measureBackground(document.getElementById('b'));
            const r = document.getElementById('b').getBoundingClientRect();
            return { result, rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
        });

        // Ground truth: hide the button, screenshot the rectangle it covered.
        await page.evaluate(() => { document.getElementById('b').style.visibility = 'hidden'; });
        const rect = {
            x: Math.max(0, Math.round(measured.rect.x)),
            y: Math.max(0, Math.round(measured.rect.y)),
            width: Math.round(measured.rect.width),
            height: Math.round(measured.rect.height),
        };
        const png = await page.screenshot({ clip: rect });
        const truth = await page.evaluate(`(${luminanceOfPng.toString()})("${png.toString('base64')}")`);
        await page.evaluate(() => { document.getElementById('b').style.visibility = 'visible'; });

        const lib = measured.result?.luminance ?? NaN;
        const source = measured.result?.source ?? 'none';
        const diff = Math.abs(lib - truth);
        worst = Math.max(worst, Number.isNaN(diff) ? 1 : diff);
        const ok = diff <= TOLERANCE;
        if (!ok) failures++;
        rows.push({ ok, scenario: scenario.name, at: `${x},${y}`, source, lib, truth, diff });
    }
}

await browser.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let lastName = '';
for (const row of rows) {
    if (row.scenario !== lastName) {
        console.log(`\n${row.scenario}`);
        lastName = row.scenario;
    }
    console.log(
        `  ${row.ok ? 'ok  ' : 'FAIL'} at ${row.at.padEnd(8)} ${row.source.padEnd(7)} library ${row.lib.toFixed(3)}  browser ${row.truth.toFixed(3)}  diff ${row.diff.toFixed(3)}`
    );
}
console.log(`\n${rows.length - failures}/${rows.length} spots within ${TOLERANCE}, worst difference ${worst.toFixed(3)}`);
process.exit(failures === 0 ? 0 : 1);