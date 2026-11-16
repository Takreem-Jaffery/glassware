// Demo page for Glassware. Imports the real library source, so what you see
// here is exactly what ships.

import '../packages/core/src/glassware.css';
import './demo.css';

import {
  attach,
  supportsWateryGlass,
  RANGES,
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
const bgSelect = $<HTMLSelectElement>('bg');

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

function setBackground(value: string): void {
  stage.dataset.bg = value;
  if (value === 'photo-dark' || value === 'photo-light') {
    const url = makeImage(value === 'photo-dark' ? 'dark' : 'light');
    stage.style.backgroundImage = `url(${url})`;
  } else {
    stage.style.removeProperty('background-image');
  }
  // The background changed behind the buttons, so measure it again.
  void refreshAll();
}

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
  handles.push(attach(button, preset.config));
}

const liveButton = $<HTMLButtonElement>('live');
const live = attach(liveButton, { type: 'frosted' });
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
  return `import { attach } from 'glassware';\n\n${call}`;
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

function showStatus(): void {
  const color = liveButton.style.getPropertyValue('--glass-text-color');
  const mode = color === '#f5f5f5' ? 'light' : 'dark';
  const source = state.contrastMode && state.contrastMode !== 'auto' ? 'set by you' : 'measured from the background';
  status.textContent = `Text: ${mode} (${color || 'default'}), ${source}`;
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

setBackground(bgSelect.value);
changed();