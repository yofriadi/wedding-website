## Why

Two related simplifications the couple asked for:

1. **Wishes are being retired entirely.** The wish marquee (`WishMarquee.astro`) is the _only_ surface that ever displays a wish; with it gone, the wish input in the add-story flow would collect text nothing can render. Rather than leave a write-only feature, wishes are removed end-to-end — marquee, flow input, API field, and the `wish_text` database column (the app is not deployed, so there is no data to preserve).
2. **The three example stories carry information a newcomer needs, but they vanish once a real guest posts.** The empty-wall SSR gate stops rendering the mocks and `syncMockTiles` evicts them the moment any real story exists — so an eligible invitee arriving later never sees the "how this works" cards. The fix: the **first** tap of the add-story tile (per browser) plays the three example stories, then hands off into the add-story flow; every later tap opens the flow directly. The examples stay reachable regardless of wall state.

Bundled in: the modal's neutral **"Guest story"** header text is removed (an empty header slot replaces it), which also cleans up unnamed real tiles.

## What Changes

- **Delete the wish marquee**: remove `apps/web/src/components/WishMarquee.astro`, its `#wishes-section` in `index.astro`, the `--wishes-*` design tokens, and `apps/web/tests/wish-marquee.spec.ts`.
- **Strip wishes from the add-story flow**: remove the wish input, character counter, wish error slot, and the entire rotating-placeholder feature from `AddStoryFlow.astro` + `add-story-flow.ts`. The flow becomes photo-only (≥1 photo required to submit).
- **BREAKING** (contract narrowing): `POST /api/submissions` no longer accepts `wishText` (`empty_submission` now means "no photos"); `GET /api/submissions` drops `wall.wishes` and `mine.wishText`. `SubmissionsPayload` slims to match. The only consumer of those fields was the marquee.
- **Strip wishes from the database**: remove `wishText` from the Drizzle schema and drop the `wish_text` column via migration; remove `normalizeWishText` / `WISH_TEXT_MAX_CHARS` from `lib/submissions.ts`.
- **Remove the "Guest story" modal text**: empty the header placeholder span in `StoryViewer.astro` and its client twin in `guest-rail.ts` (the span stays as a zero-width spacer so the close button keeps its right alignment). This also affects real tiles whose `firstName` is null — one code path.
- **Add the first-tap story intro**: `index.astro` renders one always-present hidden `<StoryViewer>` with the three example cards (no `data-mock`, so eviction leaves it alone); `guest-rail.ts`'s tile click branches on a `localStorage` flag (first tap → intro, then auto-open flow on the last card; later taps → flow); the `story-viewer-end`/`-prev` orchestrator scopes hand-off to rail viewers so the intro closes into the flow instead of chaining into rail tiles.
- Update `ops/MODERATION.md` (photo-only submissions; the wish-removal section is retired) and the affected Playwright specs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `add-story-flow`: the flow becomes a single photo picker (≥1 photo required); the two-optional-inputs requirement and the rotating-wish-placeholder requirement are removed; post-submit transitions drop the marquee clause; `400` maps to photo field errors only.
- `story-rail-mocks`: mock eviction is now unconditional on any real story (no wish-only exception); the modal header placeholder is empty, not "Guest story"; **added** — the three example stories play as a first-tap intro from the add-story tile and hand off into the flow, reachable regardless of wall state.
- `guest-photos`: the wall payload and `Photos served via the wall` shape drop `wishes`; the null-`firstName` fallback renders an empty modal header instead of "Guest story"; **added** (relocated from guest-wishes) — `One submission per invite` and `Submission requires photos`.
- `interaction-motion`: the `Wish marquee is pausable…` requirement is removed with the marquee.

### Retired Capabilities

- `guest-wishes`: all requirements are removed. Wish validation, the wall wish payload, and both marquee requirements disappear with the feature; the two non-wish invariants (`One submission per invite`, `Submission requires content` → `…photos`) relocate to `guest-photos`.

## Impact

- `apps/web/src/pages/index.astro` — remove marquee import/section/tokens/CSS; add the hidden intro `<StoryViewer>`; scope the story hand-off orchestrator to `[data-story-rail]`.
- `apps/web/src/components/{WishMarquee.astro (deleted), AddStoryFlow.astro, StoryViewer.astro}`.
- `apps/web/src/scripts/{add-story-flow.ts, guest-rail.ts}` — wish removal + first-tap intro branch + empty header twin.
- `apps/web/src/lib/{submissions.ts, submissions-client.ts}` — drop wish helpers and payload fields.
- `apps/web/src/pages/api/submissions/index.ts` — drop wish parse/validate/select/return.
- `packages/db/src/schema/submissions.ts` + a new migration — drop `wish_text`.
- Tests: delete `wish-marquee.spec.ts` and `placeholder-verify.spec.ts`; update `guest-rail`, `mock-tiles-verify`, `mock-gate-ssr`, `story-viewer`, `photo-pipeline`; add first-tap-intro coverage.
- Docs: `ops/MODERATION.md`.
- Data: none (not deployed; scratch DBs are recreated from migrations).
