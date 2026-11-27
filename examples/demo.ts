// Demo page for Glassware. Imports the real library source, so what you see
// here is exactly what ships.

import '../packages/core/src/glassware.css';
import './demo.css';

import {
  attach,
  measureBackground,
  supportsWateryGlass,
  RANGES,
  type BackgroundMeasure,
  type BackgroundSampler,
  type GlassConfig,
  type GlassHandle,
  type GlassType,
} from '../packages/core/src/index';
import {
  DEFAULT_DISTORTION_SCALE,
  DEFAULT_DISTORTION_SPEED,
  WATERY_DEFAULT_BLUR,
  WATERY_DEFAULT_TRANSPARENCY,
} from '../packages/core/src/watery';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`demo: missing #${id}`);
  return el as T;
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

const stage = $('stage');
const main = $('main');
const bgSelect = $<HTMLSelectElement>('bg');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Small deterministic random numbers so the generated images look the same
// on every load.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const imageCache = new Map<string, string>();

// A detailed picture drawn on a canvas. It is turned into a data URL, which
// is same-origin, so Glassware can sample it with canvas like any real photo.
function makeImage(kind: 'dark' | 'light'): string {
  const cached = imageCache.get(kind);
  if (cached) return cached;

  const size = 640;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const dark = kind === 'dark';
  const rand = mulberry32(dark ? 7 : 21);

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, dark ? '#0b1026' : '#f7f1e3');
  base.addColorStop(1, dark ? '#1d1240' : '#dce9f6');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const palette = dark
    ? ['#3a2a7a', '#12507a', '#7a1f5a', '#0f3d3a']
    : ['#f3c6d8', '#c5e2f3', '#f9e2b5', '#d6efd0'];

  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 40 + rand() * 120;
    const color = palette[Math.floor(rand() * palette.length)];
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color + 'cc');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.moveTo(rand() * size, rand() * size);
    ctx.lineTo(rand() * size, rand() * size);
    ctx.stroke();
  }

  const url = canvas.toDataURL('image/png');
  imageCache.set(kind, url);
  return url;
}

// ---------------------------------------------------------------------------
// Animated blobs, drawn on a canvas
// ---------------------------------------------------------------------------
//
// CSS blobs would be separate elements behind the buttons, which Glassware
// cannot see (it reads the backgrounds of a button's ancestors). Drawing them
// on a canvas and handing the pixels over with the sampleBackground option is
// how any canvas, video or WebGL backdrop is supported.

const blobCanvas = $<HTMLCanvasElement>('blobs');
const blobCtx = blobCanvas.getContext('2d', { willReadFrequently: true });
let canvasScale = 1; // canvas pixels per CSS pixel

// Position and size are fractions of the stage, as before: m is the longer side.
interface Blob { cx: (w: number, m: number) => number; cy: (h: number, m: number) => number; r: number; inner: string; outer: string; seconds: number }
const BLOBS: Blob[] = [
  { cx: (_w, m) => 0.13 * m, cy: (_h, m) => 0.23 * m, r: 0.19, inner: '#ff5fa2', outer: '#a4125f', seconds: 16 },
  { cx: (w, m) => 0.34 * w + 0.22 * m, cy: (_h, m) => 0.46 * m, r: 0.22, inner: '#36e0ff', outer: '#0a5fb0', seconds: 21 },
  { cx: (w, m) => w - 0.11 * m, cy: (_h, m) => 0.09 * m, r: 0.15, inner: '#ffb347', outer: '#dc4a14', seconds: 13 },
  { cx: (w, m) => 0.88 * w - 0.12 * m, cy: (h, m) => h - 0.06 * m, r: 0.12, inner: '#9dff7a', outer: '#178a4a', seconds: 18 },
];

function blobsVisible(): boolean {
  return stage.dataset.bg === 'blobs' || stage.dataset.bg === 'blobs-grid';
}

function sizeCanvas(): void {
  const rect = stage.getBoundingClientRect();
  canvasScale = Math.min(window.devicePixelRatio || 1, 2);
  blobCanvas.width = Math.max(1, Math.round(rect.width * canvasScale));
  blobCanvas.height = Math.max(1, Math.round(rect.height * canvasScale));
}

function drawBlobs(timeMs: number): void {
  if (!blobCtx || !blobsVisible()) return;
  const w = blobCanvas.width / canvasScale;
  const h = blobCanvas.height / canvasScale;
  const m = Math.max(w, h);
  blobCtx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  blobCtx.fillStyle = '#0d1030';
  blobCtx.fillRect(0, 0, w, h);

  for (const blob of BLOBS) {
    // Drift back and forth, smoothly: 0 -> 1 -> 0 over twice `seconds`.
    const p = 0.5 - 0.5 * Math.cos((Math.PI * timeMs) / (blob.seconds * 1000));
    const r = blob.r * m * (1 + 0.12 * p);
    const cx = blob.cx(w, m) + 0.05 * m * p;
    const cy = blob.cy(h, m) + 0.03 * m * p;
    const g = blobCtx.createRadialGradient(cx - 0.4 * r, cy - 0.4 * r, 0, cx - 0.4 * r, cy - 0.4 * r, 1.98 * r);
    g.addColorStop(0, blob.inner);
    g.addColorStop(1, blob.outer);
    blobCtx.fillStyle = g;
    blobCtx.beginPath();
    blobCtx.arc(cx, cy, r, 0, Math.PI * 2);
    blobCtx.fill();
  }

  if (stage.dataset.bg === 'blobs-grid') {
    blobCtx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    for (let x = 0; x < w; x += 28) blobCtx.fillRect(x, 0, 1, h);
    for (let y = h - 1; y >= 0; y -= 28) blobCtx.fillRect(0, y, w, 1);
  }
}

let blobFrame = 0;
let lastBlobDraw = 0;
function blobLoop(now: number): void {
  blobFrame = 0;
  if (!blobsVisible() || document.hidden || reducedMotion) return;
  if (now - lastBlobDraw >= 33) { // about 30 frames a second is plenty for soft blobs
    lastBlobDraw = now;
    drawBlobs(now);
  }
  blobFrame = requestAnimationFrame(blobLoop);
}

function startBlobs(): void {
  sizeCanvas();
  drawBlobs(performance.now());
  if (!blobFrame && blobsVisible() && !reducedMotion) blobFrame = requestAnimationFrame(blobLoop);
}

new ResizeObserver(() => { startBlobs(); void refreshAll(); }).observe(stage);
document.addEventListener('visibilitychange', () => { if (!document.hidden) startBlobs(); });

// Glassware calls this with a button's rectangle and wants the pixels behind it.
// Only the first 16 or so samples per side are handed over: plenty to judge brightness.
const sampleCanvas: BackgroundSampler = (rect) => {
  if (!blobCtx || !blobsVisible()) return null; // not a canvas background: measure the CSS instead
  const box = blobCanvas.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const scale = blobCanvas.width / box.width;
  const x0 = Math.max(0, Math.floor((rect.left - box.left) * scale));
  const y0 = Math.max(0, Math.floor((rect.top - box.top) * scale));
  const x1 = Math.min(blobCanvas.width, Math.ceil((rect.right - box.left) * scale));
  const y1 = Math.min(blobCanvas.height, Math.ceil((rect.bottom - box.top) * scale));
  if (x1 <= x0 || y1 <= y0) return null;

  const { width, height, data } = blobCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const cols = Math.min(width, 16);
  const rows = Math.min(height, 16);
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const from = (Math.floor(((row + 0.5) / rows) * height) * width + Math.floor(((col + 0.5) / cols) * width)) * 4;
      out.set(data.subarray(from, from + 4), (row * cols + col) * 4);
    }
  }
  return { width: cols, height: rows, data: out };
};

// ---------------------------------------------------------------------------
// Background choice, and your own image
// ---------------------------------------------------------------------------

let uploadUrl: string | null = null;
const uploadNote = $('upload-note');

function setNote(message: string, isError = false): void {
  uploadNote.textContent = message;
  uploadNote.classList.toggle('error', isError);
}

function setBackground(value: string): void {
  stage.dataset.bg = value;
  if (value === 'photo-dark' || value === 'photo-light') {
    const url = makeImage(value === 'photo-dark' ? 'dark' : 'light');
    stage.style.backgroundImage = `url(${url})`;
  } else if (value === 'upload' && uploadUrl) {
    stage.style.backgroundImage = `url("${uploadUrl}")`;
  } else {
    stage.style.removeProperty('background-image');
  }
  startBlobs();
  // The background changed behind the buttons, so measure it again.
  void refreshAll();
  if (value === 'upload') void tuneHeroText();
}

// The page text (headline, labels) is not a glass button, so it needs to pick
// its own color for an uploaded image: dark text on a light picture, and so on.
async function tuneHeroText(): Promise<void> {
  const measure = await measureBackground($('hero'));
  stage.dataset.tone = measure && measure.luminance > 0.5 ? 'light' : 'dark';
}

function useImageFile(file: File | undefined): void {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setNote(`"${file.name}" is not an image.`, true);
    return;
  }
  const url = URL.createObjectURL(file); // a same-origin blob: URL, so it can be sampled
  const probe = new Image();
  probe.onload = () => {
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    uploadUrl = url;
    if (!bgSelect.querySelector('option[value="upload"]')) {
      const option = document.createElement('option');
      option.value = 'upload';
      bgSelect.appendChild(option);
    }
    bgSelect.querySelector<HTMLOptionElement>('option[value="upload"]')!.textContent = `Your image (${file.name})`;
    bgSelect.value = 'upload';
    setNote(`Using ${file.name} (${probe.naturalWidth} x ${probe.naturalHeight}). It stays in your browser.`);
    setBackground('upload');
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    setNote(`Could not read "${file.name}" as an image.`, true);
  };
  probe.src = url;
}

const fileInput = $<HTMLInputElement>('file');
$('upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  useImageFile(fileInput.files?.[0]);
  fileInput.value = ''; // so choosing the same file again still fires
});

// Dropping an image anywhere on the page works too.
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  useImageFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------------------
// Glass buttons
// ---------------------------------------------------------------------------

const handles: GlassHandle[] = [];

function refreshAll(): Promise<void> {
  return Promise.all(handles.map((h) => h.refresh())).then(showStatus);
}

// Presets: each one is a different config, so you can compare them side by side.
const PRESETS: Array<{ label: string; note: string; config: GlassConfig }> = [
  { label: 'Frosted', note: 'attach(btn)', config: {} },
  { label: 'Watery', note: "{ type: 'watery' }", config: { type: 'watery' } },
  {
    label: 'Watery, strong',
    note: "{ type: 'watery', distortionScale: 50, distortionSpeed: 4 }",
    config: { type: 'watery', distortionScale: 50, distortionSpeed: 4 },
  },
  {
    label: 'Tinted',
    note: "{ tint: '#5abeff', transparency: 0.3 }",
    config: { tint: '#5abeff', transparency: 0.3 },
  },
  { label: 'Pill', note: '{ radius: 32 }', config: { radius: 32 } },
  { label: 'No edge', note: '{ edgeReflection: false }', config: { edgeReflection: false } },
];

const gallery = $('gallery');
for (const preset of PRESETS) {
  const wrap = document.createElement('div');
  wrap.className = 'preset';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = preset.label;
  const note = document.createElement('small');
  note.textContent = preset.note;
  wrap.append(button, note);
  gallery.appendChild(wrap);
  handles.push(attach(button, preset.config, { sampleBackground: sampleCanvas }));
}

const liveButton = $<HTMLButtonElement>('live');
const live = attach(liveButton, { type: 'frosted' }, { sampleBackground: sampleCanvas });
handles.push(live);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type SliderKey = 'transparency' | 'blur' | 'radius' | 'distortionScale' | 'distortionSpeed';
const SLIDERS: SliderKey[] = ['transparency', 'blur', 'radius', 'distortionScale', 'distortionSpeed'];

const sliders = {} as Record<SliderKey, HTMLInputElement>;
const outputs = {} as Record<SliderKey, HTMLOutputElement>;
for (const key of SLIDERS) {
  const input = $<HTMLInputElement>(key);
  input.min = String(RANGES[key][0]);
  input.max = String(RANGES[key][1]);
  input.step = key === 'transparency' ? '0.01' : '1';
  sliders[key] = input;
  outputs[key] = $<HTMLOutputElement>(`${key}-out`);
}

const typeSelect = $<HTMLSelectElement>('type');
const tintInput = $<HTMLInputElement>('tint');
const edgeInput = $<HTMLInputElement>('edge');
const contrastSelect = $<HTMLSelectElement>('contrast');
const snippet = $('snippet');
const status = $('status');

// Only the settings you changed live here, exactly like a real config object.
const state: GlassConfig = { type: 'frosted' };

// What the stylesheet uses when a setting is left unset (SPEC §2).
function defaultsFor(type: GlassType): Record<SliderKey, number> {
  const watery = type === 'watery';
  return {
    blur: watery ? WATERY_DEFAULT_BLUR : 12,
    transparency: watery ? WATERY_DEFAULT_TRANSPARENCY : 0.18,
    radius: 12,
    distortionScale: DEFAULT_DISTORTION_SCALE,
    distortionSpeed: DEFAULT_DISTORTION_SPEED,
  };
}

function buildSnippet(): string {
  const lines: string[] = [];
  const add = (key: string, value: string | number | boolean) => lines.push(`  ${key}: ${value},`);
  const watery = state.type === 'watery';

  if (watery) add('type', "'watery'");
  if (state.transparency !== undefined) add('transparency', Number(state.transparency.toFixed(2)));
  if (state.blur !== undefined) add('blur', state.blur);
  if (state.radius !== undefined) add('radius', state.radius);
  if (state.tint !== undefined) add('tint', `'${state.tint}'`);
  if (state.edgeReflection === false) add('edgeReflection', false);
  if (state.contrastMode !== undefined) add('contrastMode', `'${state.contrastMode}'`);
  if (watery && state.distortionScale !== undefined) add('distortionScale', state.distortionScale);
  if (watery && state.distortionSpeed !== undefined) add('distortionSpeed', state.distortionSpeed);

  const call = lines.length ? `attach(button, {\n${lines.join('\n')}\n});` : 'attach(button);';
  return `import '@glassware/core/glassware.css';\nimport { attach } from '@glassware/core';\n\n${call}`;
}

// Sliders show the value in effect: your setting, or the default for this type.
function render(): void {
  const type = state.type ?? 'frosted';
  const defaults = defaultsFor(type);

  for (const key of SLIDERS) {
    const value = state[key] ?? defaults[key];
    sliders[key].value = String(value);
    outputs[key].textContent = key === 'transparency' ? value.toFixed(2) : String(value);
  }
  sliders.distortionScale.disabled = type !== 'watery';
  sliders.distortionSpeed.disabled = type !== 'watery';

  typeSelect.value = type;
  tintInput.value = state.tint ?? '#ffffff';
  edgeInput.checked = state.edgeReflection !== false;
  contrastSelect.value = state.contrastMode ?? 'auto';
  snippet.textContent = buildSnippet();
}

const SOURCES: Record<BackgroundMeasure['source'], string> = {
  custom: 'the canvas under it',
  region: 'the background under it',
  color: 'the background color',
  image: 'the whole image (rough estimate)',
  hint: 'your data-glass-bg hint',
};

const swatch = $('swatch');
const statusText = $('status-text');

function showStatus(): void {
  const color = liveButton.style.getPropertyValue('--glass-text-color');
  const mode = color === '#f5f5f5' ? 'light' : 'dark';
  const measure = live.measurement;
  if (!measure) {
    swatch.hidden = true;
    const why = state.contrastMode && state.contrastMode !== 'auto' ? 'set by you' : 'default';
    statusText.textContent = `Text: ${mode}, ${why}`;
    return;
  }
  const { r, g, b } = measure.color;
  swatch.hidden = false;
  swatch.style.background = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  statusText.textContent =
    `Text: ${mode}. Behind the button: brightness ${measure.luminance.toFixed(2)}, from ${SOURCES[measure.source]}`;
}

function applyLive(): void {
  // Every key is passed, including undefined ones, so a setting you reset
  // goes back to its default instead of keeping its old value.
  const config: GlassConfig = {
    type: state.type,
    transparency: state.transparency,
    blur: state.blur,
    radius: state.radius,
    tint: state.tint,
    edgeReflection: state.edgeReflection,
    contrastMode: state.contrastMode,
    distortionScale: state.distortionScale,
    distortionSpeed: state.distortionSpeed,
  };
  void live.update(config).then(showStatus);
}

function changed(): void {
  render();
  applyLive();
}

for (const key of SLIDERS) {
  sliders[key].addEventListener('input', () => {
    state[key] = Number(sliders[key].value);
    changed();
  });
}

typeSelect.addEventListener('change', () => {
  state.type = typeSelect.value as GlassType;
  changed();
});

tintInput.addEventListener('input', () => {
  state.tint = tintInput.value;
  changed();
});

edgeInput.addEventListener('change', () => {
  if (edgeInput.checked) delete state.edgeReflection;
  else state.edgeReflection = false;
  changed();
});

contrastSelect.addEventListener('change', () => {
  if (contrastSelect.value === 'auto') delete state.contrastMode;
  else state.contrastMode = contrastSelect.value as 'light' | 'dark';
  changed();
});

bgSelect.addEventListener('change', () => setBackground(bgSelect.value));

$('reset').addEventListener('click', () => {
  for (const key of Object.keys(state) as Array<keyof GlassConfig>) delete state[key];
  state.type = 'frosted';
  changed();
});

const copyButton = $<HTMLButtonElement>('copy');
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(snippet.textContent ?? '');
    copyButton.textContent = 'Copied';
  } catch {
    copyButton.textContent = 'Copy failed';
  }
  setTimeout(() => (copyButton.textContent = 'Copy code'), 1400);
});

$('support').textContent = supportsWateryGlass()
  ? 'Watery glass is supported in this browser.'
  : 'This browser does not support watery glass, so watery buttons fall back to frosted.';

// ---------------------------------------------------------------------------
// Dragging the test button
// ---------------------------------------------------------------------------
//
// The button moves with the CSS `translate` property, which does not touch the
// glass's own transform transition, so it follows the pointer without lag.
// Every move re-measures what is under it.

let offsetX = 0;
let offsetY = 0;

// Where the button would sit with no offset, and the area it may roam in.
function dragLimits() {
  const rect = liveButton.getBoundingClientRect();
  const area = main.getBoundingClientRect();
  const left = rect.left - offsetX;
  const top = rect.top - offsetY;
  const margin = 8;
  return {
    minX: area.left + margin - left,
    maxX: area.right - margin - rect.width - left,
    minY: area.top + margin - top,
    maxY: area.bottom - margin - rect.height - top,
  };
}

let liveFrame = 0;
function measureLiveSoon(): void {
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    void live.refresh().then(showStatus);
  });
}

function moveLiveTo(x: number, y: number): void {
  const limits = dragLimits();
  offsetX = Math.min(Math.max(x, limits.minX), Math.max(limits.minX, limits.maxX));
  offsetY = Math.min(Math.max(y, limits.minY), Math.max(limits.minY, limits.maxY));
  liveButton.style.translate = `${offsetX}px ${offsetY}px`;
  measureLiveSoon();
}

liveButton.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  liveButton.setPointerCapture(e.pointerId);
  liveButton.classList.add('dragging');
  const startX = e.clientX;
  const startY = e.clientY;
  const fromX = offsetX;
  const fromY = offsetY;

  const move = (ev: PointerEvent) => moveLiveTo(fromX + ev.clientX - startX, fromY + ev.clientY - startY);
  const end = () => {
    liveButton.classList.remove('dragging');
    liveButton.removeEventListener('pointermove', move);
    liveButton.removeEventListener('pointerup', end);
    liveButton.removeEventListener('pointercancel', end);
  };
  liveButton.addEventListener('pointermove', move);
  liveButton.addEventListener('pointerup', end);
  liveButton.addEventListener('pointercancel', end);
});

liveButton.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 48 : 12;
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  };
  const move = delta[e.key];
  if (!move) return;
  e.preventDefault();
  moveLiveTo(offsetX + move[0], offsetY + move[1]);
});

liveButton.addEventListener('dblclick', () => moveLiveTo(0, 0));

// ---------------------------------------------------------------------------
// Keeping measurements fresh
// ---------------------------------------------------------------------------

// Scrolling slides the buttons over the background.
let scrollFrame = 0;
main.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; void refreshAll(); });
});
window.addEventListener('resize', () => moveLiveTo(offsetX, offsetY));

// The blobs and the sunset halo move by themselves. A few times a second is
// enough for text to follow them, and the text color change is faded in CSS.
function animatedBackground(): boolean {
  return blobsVisible() || stage.dataset.bg === 'sunset';
}
setInterval(() => {
  if (document.hidden || reducedMotion || !animatedBackground()) return;
  void refreshAll();
}, 250);

setBackground(bgSelect.value);
changed();