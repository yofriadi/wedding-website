# Design: loader-timeline-photo-gate

> **Partially superseded by [`adaptive-media-tiering`](../adaptive-media-tiering/design.md).**
>
> This file holds the densest collection of stale references in the change and
> is annotated rather than rewritten, so the original reasoning stays readable as
> the record of what was built. Specifically: the `waitForBelowFoldImages`,
> `waitForZoomParallaxReady`, `__zoomParallaxReady` and `zoom-parallax:ready`
> machinery described below no longer exists, the 16s ceiling is now 8s, and the
> "the thirteen photos are cold when the loader fades" premise no longer holds —
> the loader gates on the hero alone, and the collage is deferred again and
> promoted per network tier. The early scroll lock and the gate choreography
> described here stand unchanged.

## Context

The loading screen waits on a fixed media gate: hero-image readiness + audio `canplay`, with a 2.6s minimum dwell (so the phrase beat stays legible) and an 8s hard ceiling (so the page always opens).

`ZoomParallax` and `TimelineScroll` sit below the fold — HeroZoom and FamiliesReveal precede them — so without help their thirteen photos are cold when the loader fades. The couple asked for the phrase beat to gatekeep on them: the timeline first, then — after a live pass showed the collage's empty frames on a fast first scroll — the collage too. A second live pass added the constraint that shapes this design: the hold must not depend on any deferred module executing. A page load where the module scripts died (a degraded dev server) ended the phrases at the deadline and left the collage shipping no `src` at all — alt text in empty frames — because a `data-src` image only ever fetches if some script swaps it.

Three adjacent facts shaped the design:

- The gated markup parses _before_ the loader's inline script (components at the top of `<body>`, script further down), so when the inline script runs the gated `<img>`s already exist and — shipping real srcs — their fetches are already underway. The gate only has to wait, never to start anything.
- The gate arms (and first scroll-locks) from a MutationObserver on the loader's removal. Under throttled networking the loader used to dismiss before DOMContentLoaded (deferred module fetches delay DCL more than media does), so the lock happened to be in place by DCL. Extending the loader's hold broke that coincidence.
- taze bumped the workspace typescript catalog to `^7.0.2` against its own "stay on 6.x" comment; `astro check` — which needs TS 6's programmatic API — has been dead since, leaving diagnostics unfixed.

## Goals / Non-Goals

**Goals:** every gated photo (ten collage + three timeline) fetched (or failed) before the loader fades, on any page load where scripts run at all — and fetched even on loads where every deferred module fails; the page still opens at the 8s ceiling no matter what; the scroll lock holds for the whole loading + armed window by construction, not timing; `astro check` green again.

**Non-Goals:** raising the ceiling (the loader stays a progress beat, not a hard gate); fetchpriority tuning; keeping a progressive `data-src` mechanism for sections the gate does not cover (none remain); fixing the dependency-bump test failures (families-reveal, scroll-fade, hero end-state, crossfade); speccing the loader's media-gate composition as a new capability.

## Decisions

### D1 — Ship real srcs on the gated sections, not data-src + hydration

The gated `<img>`s and `<source>`s render with their real `src`/`srcset`, so the browser starts fetching them during parse — with or without any JavaScript. The `<picture>` still selects the AVIF source, exactly the bytes later displayed; there is no side-channel preloader (`new Image()`) to guess formats or double-download, and no hydration step whose absence leaves an image with no `src`. Sections the gate does not cover no longer exist, so the `data-src` pattern is gone from the page entirely.

### D2 — The inline gate waits directly; no module handoff

The first design parked a resolver on `window` and let the deferred progressive-loader module hydrate the sections and call it. A live pass killed it: when the module scripts fail to run (degraded dev server, bundle failure), the resolver is never called, the phrases end at the deadline, and — worse — the `data-src` images never fetch at all. The replacement has no handoff: `waitForBelowFoldImages()` runs in the inline loader script, whose execution the cycling phrases themselves prove, and waits on `load`/`error` (with a `complete` fast path) for the images the markup already started fetching. The only remaining backstop is the 8s deadline.

### D3 — Settle and decode on the gate path; wait for ZoomParallax animation readiness

`waitForBelowFoldImages` resolves each image on its `load` or `error` event (or immediate check if already complete), and then calls `await image.decode()` in a safe try/catch for every image with `naturalWidth > 0`. This ensures that all 10 ZoomParallax collage images and 3 timeline photos are not just in the HTTP cache, but uncompressed and resident on GPU textures before the loader fades — preventing any raster decode stutter or alt-text flash on the first scroll down.

In addition, `waitForZoomParallaxReady()` waits for `initZoomParallax()` to execute (via `window.__zoomParallaxReady` and `zoom-parallax:ready` custom event) so the Motion `scroll()` bindings and center scale factor are active before the gate opens. The `LOADER_MAX_WAIT_MS = 16000` hard ceiling continues to backstop all promises in `initLoadingScreen`.

### D4 — The progressive-loader module is removed, not kept dormant

With both `[data-progressive-section]` consumers (the collage and the timeline) converted to gated real-src sections, no section used the observer/`hydrate` mechanism, and its `section:images-ready` event had zero listeners. Keeping it would be dead weight with a live trap: the next author to mark a section would silently reintroduce images that never fetch without JS. The module script is deleted; if a future below-fold section needs deferral, it arrives with an explicit decision about whether the loader gates on it.

### D5 — The ceiling is set to 16s for mobile / 3G networks

Under "Good 3G" throttling (1.5 Mbps / ~180 KB/s), the ten ZoomParallax AVIFs (~920 KB) + hero image (~250 KB) and Vite CSS/JS bundles require ~11-14 seconds to fully download and decode. With the previous 8s ceiling, the loader timed out prematurely while 6 of the 10 images were still in flight, leaving guests with broken/alt-text boxes upon opening the welcome gate and scrolling down. Raising `LOADER_MAX_WAIT_MS` to 16s allows slow mobile connections sufficient time to complete fetching and decoding, while fast connections (WiFi/4G) continue to dismiss at the 2.6s minimum dwell. In addition, `preload="none"` on the timeline video in `TimelineScroll.astro` frees up 700 KB of bandwidth during the initial gate window.

### D6 — The gate locks scroll on first script run

The gate's inline IIFE calls `lockScroll()` immediately after its gate-element check (safe: function declarations hoist within the IIFE), while arming — gesture binding, `inert`, failsafe cancel — still waits for the loader's removal MutationObserver.

Why: with the loader holding for media (now including the below-fold AVIFs), it can outlive DOMContentLoaded on a throttled network. The gate previously first locked at arm time (loader removal); between DCL and dismissal nothing locked scroll, and a guest could scroll the raw page behind the overlay — precisely the "land mid-timeline" trap `swipe-gate-reveal` was built to kill, resurrected through the back door. The throttled-network test only ever caught this by timing coincidence (DCL lands after dismissal); the fix makes the invariant hold by construction.

Why not arm early instead: `arm()` also cancels the gate's CSS failsafe auto-dismiss and binds gesture listeners. Cancelling the failsafe while the loader still covers the gate would remove the trap-escape for a wedged loader, and binding gestures under a full-screen overlay buys nothing. Locking is the only part of arming that must move.

Margins: the failsafe fires at 25s; the loader ceiling is 16s + 300ms fade — arming always precedes it with ~8.7s to spare. The unlock path is untouched (reveal commit → `unlockScroll`), verified end-to-end in the reduced-motion flow, where dismissal is a single tap.

### D7 — astro check restoration is a catalog revert, not a workaround

The workspace's typescript catalog comment already documents the contract ("TS 7 drops the programmatic API `astro check` needs; stay on 6.x until … ships"); taze bumped the pin to `^7.0.2` against it. Reverting to `^6.0.3` restores `check-types` for web, at the cost of TS 7's native speed in `packages/db`/`env` (plain `tsc --noEmit` works on either). The diagnostics it unblocked: two `sharp` namespace errors (`sharp.Sharp`/`sharp.Exif` cannot be qualified through the default import of sharp's `export =` module — fixed with named `import type`), and six unused-symbol hints deleted at their sources rather than suppressed.

### D8 — Fixture surgery anchors on identity, not layout

Astro 7's dev server pretty-prints served HTML (attributes across lines, CSS numbers normalized), so the entrance tests' exact-string replaces on the old compact markup silently no-opped — the wrapper div never existed, the confirmed button's parent stayed `<body>` (always "in view"), and the entrance never collapsed. The replaces now anchor on `id="slide-confirmed"` with whitespace-tolerant regexes (`[^>]*` crosses newlines but never a tag boundary), verified against both the compact and pretty-printed fixture forms. The fixture itself is regenerated (nothing hand-written, per its header) and the diff audited: format churn plus the three mirrored component-script edits, no semantic drift.

## Risks / Trade-offs

- **R1 — Bandwidth contention on cold loads**: the thirteen AVIFs now race the hero image and audio during the loader (previously scroll-time). Bounded by the ceiling; repeat visits settle from cache with the min dwell governing.
- **R2 — `waitForBelowFoldImages` has no try/catch**: nothing on its path throws (`querySelectorAll`, `complete` reads, event listeners); if that ever changes, the failure mode is the 8s deadline, not a wedge.
- **R3 — `#zoom-parallax-container` / `#timeline-section` are cross-file contracts**: the inline script's selector is the one coupling to the components' markup (both components carry a comment saying so). A rename degrades gracefully (section not found → empty image set → loader ungated) at the cost of the feature silently disappearing; this change's tasks and design record the coupling.
- **R4 — Pre-existing failures read as noise**: 22 suite failures exist identically on clean HEAD (dependency-bump fallout). They were re-verified as unchanged by this work; fixing them is out of scope.
