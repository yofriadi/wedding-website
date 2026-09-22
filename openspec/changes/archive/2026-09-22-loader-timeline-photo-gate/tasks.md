# Tasks: loader-timeline-photo-gate

Loader work is in `apps/web/src/pages/index.astro` (inline loader script); gate work is in `apps/web/src/components/WelcomeGate.astro`. The 2.6s minimum dwell is untouched; the ceiling (`LOADER_MAX_WAIT_MS`) is set to 16s so Good 3G networks have sufficient runway.

> **Partially superseded by [`adaptive-media-tiering`](../adaptive-media-tiering/proposal.md).**
> Sections 1 and 2 below (the below-fold loader gate, the 16s ceiling, the
> collage's real-`src` markup — `TimelineScroll` still ships real sources by
> design) and the 25s failsafe in 3.3 no longer describe the
> shipped loader: the gate is now first-view media only against an 8s ceiling, the
> collage is deferred again and promoted per network tier, and the failsafe is back
> to 15s. Kept as the record of what was built and why. Section 3's early scroll
> lock and section 4/5's `astro check` and fixture repair stand unchanged.

## 1. Loader gates on the below-fold photos (collage + timeline)

- [x] 1.1 Inline loader script: `BELOW_FOLD_GATE_IMAGES` selector (`#zoom-parallax-container img, #timeline-section img`) + `waitForBelowFoldImages()` — per image, wait for `load`/`error` if not complete, followed by `await image.decode()` for GPU texture readiness — alongside `waitForZoomParallaxReady()` ensuring Motion scroll bindings and center scale factor are active before `initLoadingScreen()` dismisses.
- [x] 1.2 Add `waitForBelowFoldImages()` and `waitForZoomParallaxReady()` to `initLoadingScreen`'s media `Promise.all` (hero, audio, below-fold images, zoom parallax animation). The deadline race and min-dwell math are unchanged.
- [x] 1.3 Comment upkeep: the hard-ceiling comment lists below-fold photos as a covered stall mode; the gate comment states the settle condition precisely (fetched, or failed) and why no deferred module is in the loop.
- [x] 1.4 Scope tuned for Good 3G: `BELOW_FOLD_GATE_IMAGES` targets `#zoom-parallax-container img` (images up to ZoomParallax), with `loading="eager"` and `preload="none"` on the timeline video to keep 3G bandwidth focused on the collage; ceiling set to 16s and WelcomeGate CSS failsafe to 25s.

## 2. Gated sections ship real srcs (redesign after a second live pass)

- [x] 2.1 `ZoomParallax.astro` + `TimelineScroll.astro`: `data-srcset` → `srcset`, `data-src` → `src`, `data-progressive-section` removed from both containers; each carries a comment stating the images are loader-gated and must not be deferred back to `data-src`.
- [x] 2.2 Delete the progressive-image module script from `index.astro` (observer, `hydrate`, `observeSections`, the window-resolver handoff, `section:images-ready` — zero listeners). With both marked sections converted, no consumer remained; keeping it would leave a trap where a newly marked section's images never fetch without JS.
- [x] 2.3 Why: a live pass on a degraded dev server (module scripts dead) ended the phrases at the deadline and showed the collage as alt text in empty frames — `data-src` images only fetch if some script swaps them. Real srcs fetch at parse with or without JS; the inline script — whose execution the cycling phrases prove — waits on them directly.
- [x] 2.4 Robustness audit (dev server, Playwright): with every module request aborted, all 13 gated images still fetch and the loader still holds until they settle — identical numbers to the unblocked run.

## 3. Welcome gate locks scroll on first run

- [x] 3.1 Call `lockScroll()` immediately after the IIFE's gate-element check (function-declaration hoisting makes the forward call safe); arming — gesture binding, inert, failsafe cancel — still waits for the loader's removal MutationObserver.
- [x] 3.2 Comment documents why: the loader gates on media fetches and can outlive DOMContentLoaded on a slow network; between the two surfaces nothing locked scroll.
- [x] 3.3 Interaction audit: the gate's CSS failsafe fires at 15s, the loader's ceiling is 8s + 300ms fade — arming always precedes the failsafe with ~6.7s of margin; the reveal commit's `unlockScroll` path is unchanged (verified in the reduced-motion flow).

## 4. `astro check` restoration + diagnostics

- [x] 4.1 Revert the typescript catalog `^7.0.2` → `^6.0.3` (the taze bump contradicted the catalog's own "stay on 6.x until the language-server API ships" comment; `astro check` needs TS 6.x). Lockfile delta is the typescript swap only.
- [x] 4.2 `image-encode.ts`: `import type { Sharp } from "sharp"` — `sharp.Sharp` cannot qualify through the default import of sharp's `export =` module.
- [x] 4.3 `photo-pipeline.spec.ts`: same for `Exif` (`as unknown as Exif`).
- [x] 4.4 Delete the six unused-symbol hints at their sources: `setupEntrance`'s `label` param + `isConfirmed` local (SlideToConfirm), `ROW_H` (ZoomParallax, dead since the svh migration), `stops`/`dark` (slide-to-confirm spec), `match` → `_match` (fixture generator).
- [x] 4.5 Regenerate `tests/fixtures/slide-to-confirm.html` from the dev server so it mirrors the component-script edits (the regeneration also picks up Astro 7's pretty-printed dev output — see 5.1).

## 5. Fixture and test repair

- [x] 5.1 Audit the regenerated fixture's diff: pretty-printed markup, CSS numeric normalization, the sourcemap blob, the three mirrored script edits, and label whitespace — no semantic drift; all suites green against it.
- [x] 5.2 Entrance tests' confirmed-button wrapper replaces: anchor on `id="slide-confirmed"` with whitespace-tolerant regexes (`/<button(?=[^>]*id="slide-confirmed")/` and `/<\/button>(?=\s*<\/body>)/`) instead of exact one-line strings that Astro 7's dev output no longer emits; verified against both the compact and pretty-printed fixture forms.
- [x] 5.3 Fresh-button helper (`openEntrance`) needed no change — its single-tag anchors (`<body>`, first `</button>`, `</head>`) match in both formats.

## 6. Verification

- [x] 6.1 `astro check`: 0 errors / 0 warnings / 0 hints (was: 2 errors + 6 hints, tool non-functional). `pnpm exec turbo run check-types`: 3/3 workspaces green. `oxlint`/`oxfmt`: clean. `astro build`: clean.
- [x] 6.2 Loader gate runtime (dev server, Playwright, cold cache): all 13 below-fold fetches start immediately under the loader; polling while the loader is up shows the collage 10/10 and timeline 3/3 `complete` before dismissal; the loader fades at +3.1s locally (2.6s min dwell governs — images settle inside it); with the below-fold images stalled forever the loader opens at +8.4s (ceiling honored); on arrival at the collage after the gate, 10/10 loaded — no empty frames.
- [x] 6.3 Scroll-lock lifecycle (production build): `overflow: hidden` at DOMContentLoaded while the loader is still up (throttled-network regression fixed); gate visible after dismissal; reduced-motion flow dismisses instantly and unlocks scroll; the throttled-network Playwright test passes on both projects.
- [x] 6.4 Hydration paths (dev server): collage and timeline via preload (13/13 complete before dismissal), and the observer's re-fire on the pre-hydrated sections no-ops with srcs intact.
- [x] 6.5 Suite state: 357 passed / 5 skipped / 22 failed — the 22 verified failing identically on clean HEAD (families-reveal ×16, scroll-fade ×2, welcome-gate hero end-state ×2, slide-to-confirm crossfade ×2: dependency-bump fallout, out of scope). Net +2 passed vs. the pre-fix baseline (the two throttled-network tests).
- [x] 6.6 Three review rounds applied, each catching a real defect: the stray-quote replacement string that silently broke the entrance wrapper; the scroll-lock window when the loader outlives DCL; the "fetched + decoded" comment overstatement. A fourth full round (failsafe-vs-ceiling margin, spec-compliance sweep, full-suite re-run) found no new defects.
- [x] 6.7 Redesign audits (dev server, cold cache): normal, modules-blocked, and +150ms-per-request throttled runs all show zoom 10/10 + timeline 3/3 `complete` at loader dismissal, with exactly 14 AVIF fetches (13 gated + hero — no double downloads); suite unchanged at 357 passed / 5 skipped / 22 pre-existing failures.
