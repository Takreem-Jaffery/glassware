# Glassware Design Spec

Platform-agnostic design language for Glassware. Every implementation
(CSS, Android, iOS) must honor these values and names for consistency.

Design lineage: the "watery" glass type is inspired by Apple's Liquid
Glass design language (iOS 18+). Glassware's implementation is written
independently using open web standards (SVG filters); it is not a port
of Apple's code or design assets.

## 1. Glass Types

Glassware supports two distinct rendering strategies, selected via the
`type` config option. Both share the same transparency/tint system —
only the distortion technique differs.

| Type       | Technique                                     | Support           |
|------------|------------------------------------------------|-------------------|
| `frosted`  | `backdrop-filter: blur()`                       | Universal (default) |
| `watery`   | `backdrop-filter: blur() url(#displacement)`    | Chromium-first, enhanced |

**Fallback rule:** `watery` MUST detect support via `CSS.supports('backdrop-filter', 'url(#x)')`
(or equivalent per-platform capability check) and silently render as
`frosted` when unsupported. Never show a broken/undistorted glass with
no blur — degrade one tier, not to nothing.

## 2. Visual Tokens

| Token                     | Default | Range        | User-configurable? |
|----------------------------|---------|--------------|---------------------|
| `--glass-blur`              | 12px (`watery`: 4px) | 4px–24px | Yes         |
| `--glass-transparency`      | 0.18 (`watery`: 0.08) | 0.05–0.45 | Yes (primary user-facing knob) |
| `--glass-tint`               | rgba(255,255,255,1) | any color | Yes — tint color mixed at `transparency` alpha |
| `--glass-radius`            | 12px    | 0px–32px     | Yes |
| `--glass-distortion-scale`  | 40      | 10–50        | Yes, `watery` only — feDisplacementMap scale |
| `--glass-distortion-speed`  | 8s      | 4s–16s       | Yes, `watery` only — noise animation duration |

**Per-type defaults:** `watery` is meant to be see-through, so it starts
from a lower blur and fill than `frosted` (see the table). Frosted blur
smears the backdrop, which would hide the distortion that makes watery
look different. A value the developer sets explicitly always wins over
either default, and implementations must apply the per-type default only
when the developer left the token unset.

**Naming decision:** `transparency` (not `opacity`) is the public-facing
name, since "opacity" is ambiguous about opacity of *what* (the glass
fill vs. the whole element). `transparency` maps internally to the
fill alpha channel.

## 3. Edge Reflection Tokens

| Token                          | Default | Notes |
|----------------------------------|---------|-------|
| `--glass-edge-enabled`            | true    | Toggle on/off |
| `--glass-edge-highlight`          | inset 1px 1px 1px rgba(255,255,255,0.6) | Simulated top-left light catch |
| `--glass-edge-shadow`             | inset -1px -1px 1px rgba(0,0,0,0.15)    | Simulated bottom-right falloff |

Implemented via layered inset `box-shadow` — not a gradient or image —
so it stays a single flat CSS property and is cheap to render.

**Web spelling of the toggle:** CSS cannot switch a `box-shadow` on and
off from a boolean variable, so on the web `--glass-edge-enabled` is
expressed as the `data-glass-edge="off"` state hook (see §6.2). Native
implementations expose it as the `edgeReflection` config flag.

## 4. Contrast / Text Color Algorithm

Goal: text on a glass button must stay legible regardless of what's behind it.

**Decision: relative luminance sampling with a fallback.**

- **Primary approach (JS-enhanced):** sample the average color of the
  background area directly behind the element (via canvas `getImageData`
  on a rendered snapshot, or a developer-supplied `data-glass-bg` color
  if sampling isn't available), compute relative luminance using the
  WCAG formula, and pick black or white text based on a 0.5 threshold.
- **Fallback (CSS-only, no JS):** developer manually sets
  `data-glass-mode="light"` or `"dark"` to declare what's behind the button.
  This guarantees the library works with zero JavaScript, just degrades
  from "automatic" to "declared."

**Terminology:** `light` / `dark` in `data-glass-mode` and in the
`contrastMode` config describe the **background** behind the element
(its tone). The resulting **text** color is the inverse: a `light`
background gets dark text, a `dark` background gets light text.
Implementations should keep these two ideas in separate types or names.

**Why not just always use white text with a dark overlay?**
Because part of the differentiator is that it *works on any background*,
light or dark — that's the harder, more interesting problem, and it's
this behavior that's easiest to demo well.

**Threshold:** WCAG relative luminance > 0.5 → use dark text (`#1a1a1a`).
Otherwise → use light text (`#f5f5f5`). This is a simplified version of
WCAG contrast ratio checking, not full AA/AAA compliance — documented as
a known limitation for v1, upgradeable later.

**Measuring what is behind the element.** The measurement is of the
**region directly under the element's current rectangle**, not of the
whole background. A button over the dark corner of a photo and the same
button over its bright corner get different results. Implementations
measure the region by averaging the relative luminance of a grid of points
(about one per 4px, at most 32 per side) across the element's bounding
rectangle, with whatever paints behind it composited in order (page,
ancestors' colors, images, gradients, translucent layers). Web
implementations model the CSS background stack of the element's ancestors
(`background-size`, `-position`, `-repeat`, `-origin`, `-attachment`,
gradients, the page background painted over the whole canvas); native
implementations should read the pixels behind the view. When the region
can't be worked out (no layout, an unsupported background, an unreadable
image) the implementation falls back to a rougher estimate of the whole
background, then to the `data-glass-bg` hint.

**Custom backdrops.** Backgrounds that CSS can't describe (an animated
canvas, a video, WebGL) are supported through a developer-supplied sampler:
a function that receives the element's rectangle and returns the pixels
under it, a single color, or nothing (to fall back to measuring the CSS).
Web: the `sampleBackground` option (§7.1). Native implementations should
offer the same hook in idiomatic form.

**No flicker.** Re-measuring happens whenever the background or the element
moves (`refresh()`). To stop the text color flipping back and forth on a
soft gradient, once a text color has been chosen from a measurement it only
changes after luminance passes the threshold by a margin of **0.04**
(hysteresis). The first decision, and any decision after a declared mode,
uses the plain threshold. Changing the text color should be a short fade
(the web stylesheet uses 0.2s), not a snap.

**Precedence when resolving text color:**

1. `contrastMode` config set to `light` / `dark`
2. `data-glass-mode` attribute
3. The developer's sampler (`sampleBackground`), when it returns something
4. The region under the element, measured from the background
5. A solid background color, or the whole image averaged (rough estimate)
6. `data-glass-bg` hint, when sampling isn't possible
7. Default: dark text (assumes a light page)

**Known limitations (web).** Only backgrounds of the element's ancestors
are measured, so an overlapping sibling element or a positioned layer that
is not an ancestor is invisible to it (use the sampler for those).
`calc()` in positions, four-value positions, `image-set()`, conic gradients
and `background-blend-mode` are not modelled and fall back to the rough
estimate. Cross-origin images need CORS headers to be readable; otherwise
the fallbacks apply.

## 5. Interaction Tokens (reserved for Phase 0.5+, not implemented yet)

| Token                  | Purpose                                    |
|-------------------------|---------------------------------------------|
| `--glass-sound-click`   | Audio cue key for click events              |
| `--glass-crack-clicks`  | Number of clicks before crack animation begins |
| `--glass-crack-reset`   | Whether crack state persists across reloads |

These are declared now so future modules plug into named, agreed-upon
slots instead of inventing new conventions per platform. See §7 for how
these surface in the JS config object once implemented — this table
documents the token names and intent; §7 documents the code shape.

## 6. Naming Conventions

- CSS classes: `.glass`, `.glass--{variant}` (e.g. `.glass--crackable`)
- Data attributes: `data-glass-*` (e.g. `data-glass-mode`, `data-glass-crack`)
- JS API: `glassware.attach(element, config)`
- Config keys mirror data attributes: `{ mode, crack, sound }`

The spellings below are the **web** ones. Native implementations don't
use DOM attributes or CSS variables, but must expose the same concepts
under the same names, so behavior and documentation line up across
platforms.

### 6.1 Developer-set attributes (input)

Set by the developer in markup. These are the zero-JavaScript controls.

| Attribute         | Values            | Meaning |
|--------------------|-------------------|---------|
| `data-glass-mode`  | `light` \| `dark` | Declares the background tone behind the element (§4). `light` → dark text. Overridden by a `contrastMode` config of `light` / `dark`. |
| `data-glass-bg`    | any CSS color     | Background color hint, used for contrast only when sampling isn't possible (§4). |

### 6.2 Library-set state hooks (output)

Written by `attach()` and read by the stylesheet. Developers should not
set these by hand, with the exception noted in §6.1 for zero-JS use.

| Hook | Values | Meaning |
|------|--------|---------|
| `data-glass-type` | `watery` | The **resolved** type. Present only when `type` is `watery` **and** support was detected (§1) **and** the SVG filter was injected. Absent means `frosted`; the stylesheet reacts to `watery` only, so any other value renders frosted. `attach()` owns this attribute while attached and removes a hand-written one: `watery` without its filter would leave the element with no blur at all, which §1 forbids. |
| `data-glass-edge` | `off` | Edge reflection disabled (`edgeReflection: false`). Absent means enabled. Web spelling of `--glass-edge-enabled` (§3). |
| `--glass-text-color` | CSS color | The resolved text color (§4): `#1a1a1a` or `#f5f5f5`. Set inline by `attach()`; without JS it follows `data-glass-mode`. |
| `--glass-distortion-filter` | `url(#id)` | Reference to the per-element SVG displacement filter. SVG filter attributes can't read CSS variables, so each distinct distortion scale/speed pair gets its own filter. Default: `url(#glassware-displacement)`. |

### 6.3 Supporting tokens (web)

| Token                | Default | Notes |
|-----------------------|---------|-------|
| `--glass-text-dark`   | #1a1a1a | Text color used on light backgrounds (§4) |
| `--glass-text-light`  | #f5f5f5 | Text color used on dark backgrounds (§4) |

## 7. Config Schema

```js
{
  type: 'frosted' | 'watery',        // default 'frosted'; 'watery' auto-falls back
  transparency: 0.05–0.45,            // default 0.18 (watery: 0.08)
  tint: 'rgba(...)' | named color,    // default white
  blur: 4–24,                         // px, default 12 (watery: 4)
  radius: 0–32,                       // px, default 12
  edgeReflection: boolean,            // default true
  contrastMode: 'auto' | 'light' | 'dark', // 'light'/'dark' declare the BACKGROUND (§4)
  distortionScale: 10–50,             // default 40; watery only
  distortionSpeed: 4–16,              // seconds, default 8; watery only

  // reserved, not yet implemented:
  sound: string | null,
  crack: { enabled: boolean, clicksUntilCrack: number, resetOnReload: boolean }
}
```

**Validation rules** (every platform): a number outside its range is
clamped to the nearest bound; a value of the wrong type, `NaN`, or an
unknown option value is ignored, so the default applies. Only values the
developer actually set are applied, so per-type defaults (§2) and
stylesheet defaults stay in effect for everything else.

### 7.1 Web API

```js
const glass = glassware.attach(element, config, options);  // returns a handle

glass.ready            // Promise: text color for the current config is decided
glass.update(config)   // merge over current settings; undefined resets a key
glass.refresh()        // re-measure the background (it changed behind the element)
glass.detach()         // remove everything attach() added and restore the original state
glass.config           // the validated config currently applied
glass.measurement      // what the latest measurement found: { luminance, color, source }
                       // (null before the first one, and when the mode is declared)
```

`options` (all optional):

```js
{
  // Pixels or a color for the area under the element, when CSS can't say
  // (canvas, video, WebGL). Receives the element's rectangle in viewport
  // coordinates. Return { width, height, data } (RGBA), { r, g, b, a },
  // or null to fall back to measuring the CSS background. May be async.
  sampleBackground: (rect) => ImagePixels | RGBA | null,

  // Replaces the built-in image reader, e.g. to read through your own
  // CORS-enabled proxy. Receives a URL, returns RGBA pixels or null.
  readPixels: (url) => Promise<ImagePixels | ArrayLike<number> | null>,
}
```

`measurement.source` says where the number came from: `custom` (your
sampler), `region` (the CSS background under the element), `color` (a solid
color), `image` (the whole image averaged) or `hint` (`data-glass-bg`).

Attaching an element that is already attached updates it. Everything
except the text color is applied before `attach()` returns; the text color
follows asynchronously (image sampling) and `ready` resolves when it is set.
Call `refresh()` when the background behind the element changes or the
element moves (a drag, a scroll, an animation frame). Native
implementations should offer the same operations under idiomatic names.

## 8. Supported Targets

- ✅ `<button>` — Phase 0
- 🔜 `<div>` / generic container — Phase 0.7
- 🔜 Android `View` — Phase 1
- 🔜 iOS `UIView`/SwiftUI `View` — Phase 2