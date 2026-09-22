## Why

The loading screen currently gatekeeps on ~1 MB of below-fold collage AVIFs (plus a 714 KB video that the `autoplay` attribute fetches at parse time and a 3.1 MB soundtrack at `preload="auto"`), so on Good-3G-class links the loader either stalls to its ceiling or opens onto unfinished media. Fighting that with longer ceilings and bigger failsafes trades one bad outcome (premature open) for another (10+ s of phrases on a slow link). The expensive bytes are assets, not code — the whole page's JavaScript is ~70 KB — so the right lever is to spend them only on connections that can afford them: detect the network, serve a lite variant that skips the expensive operations on slow links, and keep the full experience on fast ones, from a single bundle.

## What Changes

- Add a pre-parse media tier verdict (`html[data-tier]` = `full` | `lite` | `pending`) from the Network Information API where present (saveData, effectiveType, downlink), with a measured fallback for engines without it (Safari, Firefox): aggregate throughput of the initial asset burst (hero candidate + webfonts) judged against a ~220 KB/s floor. Verdicts downgrade one way only (`full`/`pending` → `lite`); they never upgrade mid-session.
- Defer the ZoomParallax collage to `data-src`/`data-srcset` again. `full` promotes the sources synchronously at parse time (fetches race the loader exactly as real `src` would); `pending` promotes when the measurement resolves to `full`; `lite` promotes per-image on scroll approach and renders the collage as a static bento grid (no sticky pin, no scroll-driven zoom).
- Stop the timeline video from fetching at parse time: remove the `autoplay` attribute that was defeating `preload="none"`. `full` plays/pauses it by intersection; `lite` exposes `controls` and never auto-plays.
- Ship the soundtrack at `preload="none"`. `full` restores `preload="auto"` once the tier resolves and starts it at the gate commit as today; `lite` never downloads it — no autostart, no gesture arm — and the gate's "Music will play upon opening" note is hidden on lite.
- Shrink the loader's media gate to first-view media (hero fetch + decode) and drop the ceiling back to 8 s; the welcome-gate CSS failsafe returns to 15 s. The below-fold collage and the parallax binding leave the gate entirely.
- Supersede the below-fold media-gate half of the in-flight `loader-timeline-photo-gate` change (its early scroll-lock and gate choreography work stands); that change's records are amended to point here.
- No second bundle and no duplicated components: the tier is a runtime attribute that changes which assets are fetched and which bindings run; shipped JavaScript is identical across tiers.

## Capabilities

### New Capabilities

- `media-tiering`: network tier detection (synchronous signals plus measured burst-throughput refinement, one-way downgrade), tier-driven promotion of deferred media sources, and the lite variant's reduced media/animation behavior (static collage, no parallax binding, tap-only video, no soundtrack).

### Modified Capabilities

- `welcome-gate`: "Music unlocks on the reveal gesture" becomes tier-conditional — on lite the commit neither starts nor downloads the soundtrack.

## Impact

- `apps/web/src/layouts/Layout.astro`: head inline tier script (verdict, refinement, `net-tier:change` event).
- `apps/web/src/pages/index.astro`: loader gate scope + ceiling, collage promoter, audio preload control, `window.armMusicGesture` exposure.
- `apps/web/src/components/ZoomParallax.astro`: deferred sources, tier-aware bind/promote, tier-keyed pin CSS.
- `apps/web/src/components/TimelineScroll.astro`: video autoplay removal, intersection play/pause vs controls.
- `apps/web/src/components/WelcomeGate.astro`: tier-conditional music start, failsafe back to 15 s, music note hidden on lite.
- Tests: there is no `check-loader-timing.mjs` in the repo — the retired audio-`canplay` loader contract is encoded in `apps/web/tests/helpers.ts` and `apps/web/tests/welcome-gate.spec.ts` (a `test.slow()` rationale and an mp3-stall case that now passes for an unrelated reason), and must be corrected there; plus a new Playwright tier spec stubbing `navigator.connection`.
- No new dependencies; no API or schema changes.
