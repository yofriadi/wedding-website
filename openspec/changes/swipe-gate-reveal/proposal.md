# Proposal: swipe-gate-reveal

## Why

Three independent problems converge on one solution:

1. **The loading overlay is a dead wait with a trap.** It gates on the hero image _and_ a multi-MB audio `canplay`; on a throttled network it can sit for tens of seconds. Worse, it never locks scroll — guests can scroll behind it and land mid-timeline, so the hero appears "stuck" at a random state when the overlay fades (observed under Slow 3G testing).
2. **Music silently never starts on mobile.** Browsers block unmuted autoplay without a user gesture; `play()` at loader-fade is rejected, and desktop wheel/trackpad scrolling does not count as a gesture either.
3. **The invitee name is wasted on a spinner screen.** The server-rendered `displayName` currently sits above cycling shimmer jokes on the loading overlay — it deserves a deliberate "addressed to you" envelope moment.

A swipe-up welcome gate solves all three at once: the swipe's `touchend` is a guaranteed user activation (music unlocks for real), the gate scroll-locks the page (the hero zoom deterministically starts at `scale(2.8)` for everyone), the name gets its own quiet, brighter screen, and the reveal gesture doubles as an "opened the invitation" metric signal.

## What Changes

- **New `WelcomeGate` screen between loader and hero**: a fixed, brighter surface (couple-supplied background image slot with a light neutral fallback) that appears when the black loading overlay fades. Invitee `displayName` is centered (verbatim, server-rendered); a shimmer "swipe up" hint sits at the bottom. Anonymous visitors get the hint only — no name, no placeholder copy.
- **Finger-tracked swipe-up reveal (Level 2)**: the gate follows the finger 1:1 upward, resists downward pulls, springs back when released early, and flies off-screen when released past the commit threshold or with flick velocity. Reveal commit unlocks scroll, removes the gate, and starts the music inside the gesture's activation window.
- **Greeting moves from loader to gate**: `#loading-screen` returns to shimmer-phrases-only; the SSR greeting element (and its cookie lookup, verbatim rendering, and `no-store` semantics) relocates to the gate markup unchanged in mechanism.
- **New open metric**: `invites` gains `opened_at`/`opened_count`; `POST /api/invite/opened` (cookie-identified, best-effort, `no-store`) is fired once per pageview at reveal commit; a minimal admin-token-gated GET exposes the metrics.
- **Escape hatches**: desktop wheel/click/keydown also dismisses (functional, not fancy); `prefers-reduced-motion` gets instant tap-dismiss; `@media (scripting: none)` hides the gate outright; a CSS failsafe auto-dismisses unless the (inline) gesture script cancels it — the gate can never trap the page.

## Non-goals

- **Gate background image selection** — the couple supplies it later (same pattern as story teasers); this change ships the slot + fallback only.
- **Desktop polish** — desktop gets functional dismissal (wheel/click/keydown), not finger-tracked physics or bespoke copy.
- **Changing what the loader gates on** — hero image + audio `canplay` stays as-is (already mitigated by the 128 kbps re-encode).
- **Hero animation changes** — `HeroZoom.astro` keyframes/timeline/fallback are untouched; the gate only guarantees a clean scroll-0 start.
- **RSVP, households, cookie healing** — unchanged, still deferred.

## Capabilities

### New Capabilities

- `welcome-gate`: The post-loader gate surface — layout, scroll lock, finger-tracked swipe reveal, music unlock on commit, non-touch dismissal, reduced-motion/no-JS escape hatches, and the client-side open-metric trigger.
- `invite-open-tracking`: Server-side open metric — `opened_at`/`opened_count` schema, `POST /api/invite/opened` contract, best-effort semantics, `no-store`, admin read side.

### Modified Capabilities

- `guest-greeting`: the greeting element moves from the loading overlay to the welcome gate. NOTE: its source requirements live in the in-progress `invite-only-personalization` change (nothing is archived to `openspec/specs/` yet) — this change MUST archive after that one.

## Impact

- **Code**: new `apps/web/src/components/WelcomeGate.astro`; `apps/web/src/pages/index.astro` (loader markup reverts to phrases-only, greeting passes to the gate, inline gate script added); new `apps/web/src/pages/api/invite/opened.ts`; `apps/web/src/pages/api/admin/[token]/invites.ts` gains GET; `packages/db/src/schema/invites.ts` + one committed migration. `HeroZoom.astro` untouched.
- **DB**: one additive migration (`opened_at`, `opened_count`) — must run before deploy, same discipline as task 1.9 of `invite-only-personalization`.
- **Specs**: MODIFIED delta on `guest-greeting` (source in `invite-only-personalization`); archive order matters (see above).
- **Risk**: iOS touch/scroll-chaining edge cases (needs a real-device pass); open counting includes repeat visits (accepted — `opened_at` = last open, `opened_count` = reveals).
- **Egress**: negligible (one tiny POST per pageview).
