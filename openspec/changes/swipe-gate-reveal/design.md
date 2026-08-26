# Design: swipe-gate-reveal

## Context

Current entry sequence: black `#loading-screen` (invitee name + cycling shimmer phrases) waits on hero-image `decode()` + audio `canplay`, fades, then calls `startMusic()`. Measured behavior this change responds to:

- Under Slow 3G the loader can hold 20s+ (hero image ~441 KB + 4 MB MP3 racing module chunks), and it never locks scroll — guests land mid-timeline and see the hero "stuck" at arbitrary states.
- `play()` without a user gesture rejects (`NotAllowedError`), verified in headless Chromium; a `touchend`-armed fallback works, and **a swipe-up ends in `touchend`** — so a swipe gate is itself the unlock gesture.
- The greeting mechanism (cookie → SSR `displayName` at first paint, `no-store`) already works and is specced in `invite-only-personalization` (in-progress, not yet archived); this change relocates its placement, not its mechanism.
- The codebase has no drag-gesture precedent (StoryViewer only uses `pointerdown` hold). The gate introduces the first one.

## Goals / Non-Goals

**Goals:** an envelope-opening moment (brighter screen, invitee name, swipe to reveal); guaranteed music unlock on mobile; deterministic hero start (scroll locked at 0 until reveal); an "opened" metric per invite; the gate can never trap the page (no-JS, broken-JS, reduced-motion, desktop all have exits).

**Non-Goals:** choosing the gate background image (couple supplies later); desktop parity (functional dismissal only); loader gating logic; hero animation internals; analytics dashboards (a minimal admin GET is the whole read side).

## Decisions

### D1 — Curtain architecture: gate is its own fixed surface, revealed by the loader's fade

`WelcomeGate.astro` renders a `position: fixed; inset: 0` surface in the initial HTML, z-indexed _below_ the loader (`z-50`) and above the hero. The loader fade therefore _is_ the black→bright transition — no content swap on one surface, no extra overlay choreography. Rationale: the greeting must be SSR'd at first paint anyway (guest-greeting spec), so the gate must exist in initial HTML; stacking it under the loader gives the brightness transition for free.

The gate surface is deliberately brighter than the black loader and carries a background layer with a couple-supplied image slot (asset path checked at build/request time like story teasers) over a light neutral fallback. Ship the fallback; the image is the couple's pending decision.

### D2 — Level-2 finger-tracked swipe (the interaction core)

- `touchstart` records origin; `touchmove` (registered **non-passive** so it can `preventDefault` and stop scroll chaining / iOS rubber-banding) translates the gate 1:1 with the finger, clamped at `y ≤ 0` (no downward travel; optional rubber-band resistance later — clamp is the v1).
- `touchend` evaluates the commit: **distance beyond ~28% of viewport height OR upward flick velocity (~0.5 px/ms)** commits; anything else springs back (`transition` on transform, ~250ms ease-out).
- Commit animates the gate to `translateY(-100%)` (~400ms, ease-out), then removes it from the DOM (`transitionend`), unlocks scroll, and fires the open metric.
- Transform-only animation throughout — the gate never triggers layout; the hero (already compositor-heavy with `will-change`) is unaffected behind it.
- Exact thresholds/curves are implementation-tunable; the spec pins the _behavior classes_ (track, clamp, commit, spring-back), not the constants.

### D3 — Scroll lock while armed

Body gets `overflow: hidden` (and the gate has `touch-action: none`) from first paint until reveal commit. This guarantees every guest — throttled network or not — starts the hero timeline at scroll 0 = `scale(2.8)`, eliminating the mid-timeline landing states observed under throttling. The page is at scroll 0 at this point by construction, so locking costs nothing.

### D4 — Music unlock rides the reveal gesture

The committing `touchend` calls `startMusic()` **synchronously inside the handler** (transient activation window), making mobile playback policy-compliant by construction. The existing autoplay attempt at loader-fade and the armed `touchend/pointerup/click/keydown` listeners stay as the fallback path (desktop wheel dismissal has no activation — music then starts on the first click/keypress, accepted as the desktop tradeoff).

### D5 — Gate logic is an inline script, not a module

The gesture script ships `is:inline` in `index.astro` (same pattern as the existing loader/music script). A deferred Astro module would reintroduce the exact throttled-network race this change is meant to kill (guest swipes before the chunk arrives → nothing happens). Cost: ~100 unminified lines of inline JS; benefit: zero network dependency on the critical interaction.

### D6 — Failsafes: the gate can never trap the page

Three layers, cheapest first:

1. `@media (scripting: none) { #welcome-gate { display: none } }` — no JS, no gate.
2. A pure-CSS failsafe animation (long delay, e.g. 15s) fades the gate out; the inline script cancels it the moment it successfully arms the gesture. Covers enabled-but-broken/blocked JS.
3. `prefers-reduced-motion` — no tracking, no slide: first tap/click/key dismisses instantly (fade only), scroll lock still applies until then.

### D7 — Open metric: mirror the seen-metrics pattern

- Schema: `invites` gains `opened_at` (nullable int, epoch ms, last open) and `opened_count` (int, default 0, total reveals). One additive committed migration.
- Endpoint: `POST /api/invite/opened` — cookie identity only (id never in URL, per `invite-session`), bumps both fields, `204` on success, uniform `404` for absent/malformed/unknown cookie, `no-store` on everything, DB failure logs and still responds (best-effort, same as `/:id`).
- Client: on reveal commit, if `document.cookie` contains `ww_invite_id`, fire `fetch(..., { method: "POST", keepalive: true })` once per pageview, fire-and-forget — never awaited, never blocks the reveal. Anonymous visitors send nothing.
- Read side: `GET /api/admin/:token/invites` (same route file, same token check) returns rows including `opened_at`/`opened_count`. Deliberately minimal — answering "who opened it?" needs nothing more.
- Counting semantics: every reveal counts (repeat visits bump `opened_count`, overwrite `opened_at`). Honest, matches `seen_*` precedent, and "re-opened it three times" is signal, not noise.

### D8 — Loader surgery

`#loading-screen` loses the `#invite-greeting` element and reverts to shimmer-phrases-only markup (exactly the pre-personalization public shape). Everything else about the loader — what it waits for, the fade — is unchanged. The greeting element moves into `WelcomeGate.astro`, fed by the same `inviteDisplayName` frontmatter value (same cookie read, same escaping, same `no-store`).

## Risks / Trade-offs

- **R1 — iOS Safari touch edge cases**: scroll chaining and rubber-banding vary by version; non-passive `touchmove` + `touch-action: none` is the known-good combination, but this needs a real-device pass before release (task 5.3). Mitigation if it misbehaves: drop to threshold-only dismissal (Level 1) — the spec's behavior classes survive that downgrade.
- **R2 — Archive ordering**: `guest-greeting`'s source requirements live in the in-progress `invite-only-personalization` change. If this change archives first, the MODIFIED delta has no base to merge onto. Rule: archive `invite-only-personalization` first.
- **R3 — Fixed-over-fixed stacking**: gate (fixed) over pinned hero (sticky) over loader (fixed) is compositor-friendly as long as the gate animates transform/opacity only — D2 enforces this.
- **R4 — Failsafe false-trigger**: the 15s CSS failsafe could fire while a guest reads the gate. Accepted: it only survives if the inline script never ran — a broken page where auto-dismiss is the kinder failure.
- **R5 — Metric honesty**: reveals are client-triggered; a guest who closes before revealing never counts. That's the correct semantic ("opened the invitation"), just don't read it as "saw the loader".
- **R6 — Desktop is a second-class citizen by explicit choice**: wheel dismissal works, physics don't, music may wait for a click. Accepted per proposal non-goals.
