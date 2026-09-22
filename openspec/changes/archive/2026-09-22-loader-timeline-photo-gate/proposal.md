# Proposal: loader-timeline-photo-gate

> **Partially superseded by [`adaptive-media-tiering`](../adaptive-media-tiering/proposal.md).**
>
> The below-fold media-gate half of this change no longer describes the shipped
> loader: the collage wait (`waitForBelowFoldImages`, `waitForZoomParallaxReady`),
> the 16 s ceiling that existed only to give it runway, the collage's real-`src`
> markup (`TimelineScroll` still ships real sources by design), and the 25 s
> gate failsafe are replaced by
> network-tier-driven media deferral. The loader now gates on first-view media
> only (hero fetch + decode) against an 8 s ceiling; `ZoomParallax` ships
> deferred `data-src`/`data-srcset` again and is promoted per tier (at parse on
> `full`, on resolution for `pending`, per approach on `lite`); the gate failsafe
> is back to 15 s.
>
> The rest stands as written and is unaffected: the welcome gate's early scroll
> lock (`lockScroll()` on first script run) and its reveal choreography, the
> `astro check` restoration, and the fixture/test repair. This note is here so
> these records are not read as the current loader contract at archive time.

## Why

The loading phrases cycle for a fixed media gate (hero image + audio `canplay`), but the below-fold photos are fetched only when their section scrolls near the viewport — so the loader can finish while `TimelineScroll.astro`'s three photos are still cold, and the first fast flick into the section hits empty frames. The couple asked for the phrase beat to gatekeep on those photos — and, after a live pass, on the `ZoomParallax.astro` collage directly above them, which showed the same empty-frames behavior on a fast first scroll: the loader holds until every image in both sections has fetched.

Extending the loader's hold exposed a second, real gap: the welcome gate arms (and scroll-locks) only **after** the loader is removed, and the loader previously always dismissed before DOMContentLoaded under throttled networking (script fetches delay DCL more than media does). A longer-holding loader can outlive DCL — leaving a window where neither surface locks scroll and a guest can scroll the raw page behind the overlay. The invariant the throttled-network test encodes ("scroll locked at 0 while loading") has to hold by construction, not by timing coincidence.

Alongside this, `astro check` has been broken since the last dependency bump (taze moved the workspace typescript catalog to `^7.0.2`, contradicting the catalog's own "stay on 6.x" comment — TS 7 drops the programmatic API the language server needs), leaving 2 errors + 6 hints unaddressed.

## What Changes

- **Loader media gate extends to the below-fold photos**: `index.astro`'s inline loader waits on every `<img>` in `#zoom-parallax-container` (`waitForBelowFoldImages`: wait for `load`/`error` + `decode()`, with `loading="eager"` on collage images) and `waitForZoomParallaxReady()`, adding those to the existing `Promise.all` media gate. The `LOADER_MAX_WAIT_MS = 16000` hard ceiling races the gate — allowing Good 3G networks sufficient runway to finish without prematurely leaving alt text on scroll.
- **The gated sections ship real srcs**: `ZoomParallax.astro` and `TimelineScroll.astro` render `src`/`srcset` directly (no `data-src`, no `data-progressive-section`), so their thirteen photos start fetching during parse with or without JavaScript; the `<picture>` still selects the AVIF source, so there is no double download. The progressive-image module script (observer + `hydrate` + handoff) is deleted — no consumers remain. A second live pass forced the redesign: on a load where the module scripts died, the old window-resolver handoff was never called and the `data-src` images never fetched at all (alt text in empty frames) while the phrases ended at the deadline.
- **Welcome gate locks scroll on first script run**: `WelcomeGate.astro`'s inline IIFE calls `lockScroll()` immediately (function-declaration hoisting makes this safe), closing the unlocked window whenever the loader outlives DCL. Arming — gesture binding, inert, failsafe cancel — still waits for the loader's removal via the existing MutationObserver. The gate's CSS failsafe (25s) stays comfortably beyond the loader ceiling (16s + 300ms).
- **`astro check` restored**: typescript catalog reverts to `^6.0.3` per its own comment; the two `sharp` namespace errors become named type imports (`Sharp`/`Exif` — sharp's `export =` module cannot be type-qualified through a default import); the six unused-symbol hints are deleted at their sources (with the slide-to-confirm fixture regenerated to mirror the component script).
- **Fixture surgery made format-proof**: Astro 7's dev server pretty-prints served HTML (attributes across lines), so the entrance tests' exact-string fixture replaces silently no-opped. They now anchor on `id="slide-confirmed"` with whitespace-tolerant regexes, verified against both the compact and pretty-printed fixture forms.

## Non-goals

- **Removing the loader ceiling** — the loader stays a progress beat, not an unbounded gate; completely dead networks still open at 16s.
- **Fetch-priority tuning** — the thirteen AVIFs join the loader's existing bandwidth contention without `fetchpriority` hints.
- **Reviving the progressive `data-src` pattern** — no section uses it any more; a future below-fold section that wants deferral arrives with an explicit decision (including whether the loader gates on it).
- **Fixing the pre-existing suite failures** (families-reveal ×16, scroll-fade ×2, welcome-gate hero end-state ×2, slide-to-confirm crossfade ×2 — all verified failing on clean HEAD from the dependency bump; tracked separately).

## Capabilities

### New Capabilities

None. The loader's media-gate composition is pinned by no archived spec; this extends it without contradicting `interaction-motion`'s phrase-presentation requirement. Note: the active `swipe-gate-reveal` proposal listed "changing what the loader gates on" as an explicit non-goal — this change lifts that deferral.

### Modified Capabilities

- `welcome-gate`: the scroll-lock window extends — the lock now begins at the gate script's first run (before the loader's dismissal) rather than at arm time. MODIFIED delta in `specs/welcome-gate/spec.md`: the "Scroll locked while armed" requirement re-scopes the lock window and adds the loading-overlay-phase and lock-release scenarios.

## Impact

- **Code**: `apps/web/src/pages/index.astro` (inline loader script; the progressive-loader module script is deleted), `apps/web/src/components/WelcomeGate.astro` (one hoisted call + comment), `apps/web/src/components/ZoomParallax.astro` + `TimelineScroll.astro` (gated real-src markup, `data-progressive-section` removed), `apps/web/src/components/SlideToConfirm.astro` + `ZoomParallax.astro` (unused-symbol deletions), `apps/web/src/lib/image-encode.ts` + `apps/web/tests/photo-pipeline.spec.ts` (sharp type imports), `apps/web/scripts/make-slide-to-confirm-fixture.mjs`, `apps/web/tests/fixtures/slide-to-confirm.html` (regenerated), `apps/web/tests/slide-to-confirm{,-entrance}.spec.ts`, `pnpm-workspace.yaml` + `pnpm-lock.yaml` (typescript catalog revert).
- **Specs**: MODIFIED delta on `welcome-gate` (scroll-lock window) in `specs/welcome-gate/spec.md`. The loader's media-gate composition stays unpinned — the behavior is recorded in this change's proposal, design (D1–D5), and tasks rather than as a new capability.
- **Risk**: low-moderate — the loader's hold lengthens on slow networks (bounded by the 8s ceiling), and the early scroll lock changes the page's initial scrollability (verified across normal, throttled, and reduced-motion flows; the gate's unlock path is unchanged).
- **Performance**: on a cold cache the ten collage AVIFs and three timeline AVIFs move from scroll-time to load-time fetching (same bytes, earlier); on repeat visits they settle from cache and the min dwell governs.
