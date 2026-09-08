## Context

Three surfaces in the memories/submissions area, all in `apps/web`:

- **Wish marquee** (`WishMarquee.astro`, ~460 lines) — a scrolling band in `index.astro`'s `#wishes-section`. It fetches the shared `/api/submissions` payload and renders demo wishes + a "Be the first to leave a wish ✨" card (empty wall) or real wishes (non-empty). It is the **only** surface anywhere that renders a wish.
- **Add-story flow** (`AddStoryFlow.astro` + `scripts/add-story-flow.ts`) — a one-screen modal with a photo picker _and_ a wish input (≤30 chars) plus a rotating placeholder that suggests couple-curated wishes. Submitting posts multipart to `POST /api/submissions`.
- **Story rail** (`index.astro` + `scripts/guest-rail.ts` + `StoryViewer.astro` + `scripts/story-viewer-element.ts`) — on an empty wall the SSR gate (`showMockStoryTiles = !hasAnyGuestPhoto`, fail-open) renders three `data-mock` `StoryViewer` tiles from `/story_example_{1,2,3}.webp`. `syncMockTiles` evicts every `[data-mock]` element the moment the payload shows any real story. The add-story tile's click calls `openAddStoryFlow()` directly.

The wish data model: `submissions.wish_text TEXT` (nullable) in the Drizzle schema; `normalizeWishText` + `WISH_TEXT_MAX_CHARS` in `lib/submissions.ts`; `wishText` on `mine`, `wall.wishes: {text}[]` in the payload and its `SubmissionsPayload` type.

The couple's direction: wishes go away completely (nothing displays them, so collecting them is pointless), and the informational example cards must survive the first real post — reachable through the add-story tile on first tap. The app is **not deployed** (scratch SQLite recreated from migrations; `local.db` has zero submissions), so destructive schema change carries no data risk.

## Goals / Non-Goals

**Goals:**

- Remove wishes end-to-end: UI (marquee + flow input), API (POST accept / GET return), and the `wish_text` column.
- The add-story flow becomes photo-only: at least one photo required to submit.
- First tap of the add-story tile (per browser) plays the three example stories as an intro, then opens the flow; later taps open the flow directly. The intro is reachable on empty _and_ non-empty walls.
- Remove the "Guest story" placeholder text from the story modal header (empty slot, close button stays right-aligned).

**Non-Goals:**

- Any wish-adjacent replacement (private wish reader, guestbook, etc.).
- Changing photo limits, storage, attribution, posting gates, or the empty-wall mock rail itself.
- Showing the intro to public visitors (they cannot post; the add-story tile never renders for them — accepted).
- Preserving existing `wish_text` data (there is none; not deployed).

## Decisions

**D1 — Remove wishes end-to-end, including the column, rather than leaving a write-only path.**
The marquee is the only wish renderer; once it is gone, a retained wish input collects text nothing can show and a retained API field ships dead data. Because the app is not deployed, dropping the column is free. Scope: `WishMarquee.astro` (delete), the flow's wish input + counter + error + rotating placeholder, `wishText`/`wishes` in the payload and its type, `normalizeWishText`/`WISH_TEXT_MAX_CHARS`, and the `wish_text` column via a new migration. Alternative (UI-only removal, API/column kept) rejected: it leaves an unreachable feature and dead columns/fields that future readers must reverse-engineer.

**D2 — `empty_submission` becomes "no photos"; the flow requires ≥1 photo.**
With wishes gone, "at least one of wish or photos" collapses to "at least one photo". The server's multipart parser (`parseMultipart`) drops the `wishText` branch; the `invalid_wish_text` `400` code is removed; the client submit-enable predicate becomes `selectedFiles.length > 0`. Copy: the `[data-flow-error]` message changes from "Add a wish or at least one photo." to "Add at least one photo."

**D3 — First-tap intro uses one always-present hidden `<StoryViewer>` with three slides, not the rail mocks.**
The rail mocks exist only on an empty wall and are evicted by `syncMockTiles`; the intro must survive a non-empty wall, so it cannot depend on them. `index.astro` renders one extra `<StoryViewer stories={[example1, example2, example3]}>` inside a `hidden` wrapper (`data-story-intro`), **unconditionally**. One viewer with three slides (not three viewers) gives progress segments, tap-advance, and a natural end for free with no cross-viewer hand-off. It deliberately does **not** pass `mock`, so it carries no `data-mock` attribute and `syncMockTiles` never removes it. The tile button inside the hidden wrapper never paints; the modal portals to `<body>` on open like any story viewer.

Consequence: on a non-empty wall the SSR HTML now contains exactly one `<story-viewer>` (the intro) where it previously contained zero, and an empty wall contains four (three mocks + intro). `mock-gate-ssr.spec.ts` assertions move to those counts. The `data-mock` count is unchanged (3 on empty, 0 on non-empty), because the intro is not a mock.

**D4 — First-tap detection is a `localStorage` flag set on open.**
`guest-rail.ts`'s `wireTileOpen` reads `ww-story-intro-seen`. Unset → play the intro (`introViewer.openStory()`) and set the flag; set → `openAddStoryFlow()`. The flag is set on _open_ (the literal "first time they tap it"), so bailing out of the intro early still counts as seen — simple and predictable. `localStorage` access is wrapped in try/catch; on failure (private mode) the intro plays every load (safe: it never blocks posting). Alternative (per-session `sessionStorage`, or set-on-complete) rejected: the couple asked for a one-time intro, and set-on-complete would replay the whole intro on every tap until the guest watches all three cards.

**D5 — The intro hands off into the flow by cancelling its own end event, closing instantly, then opening the flow.**
When the third slide ends, `story-viewer-element` dispatches a cancelable `story-viewer-end`. `guest-rail.ts` adds a listener on the intro element that calls `e.preventDefault()` (stops the viewer's own animated `close()`), then `introViewer.closeStory({ animate: false })`, then `openAddStoryFlow()`. Doing it synchronously and non-animated avoids a scroll-lock race: the animated close's `onComplete` runs ~120ms later and would release `document.body.style.overflow` _after_ the flow opened (the flow is not a `[data-modal]`, so the "another modal is open" guard does not protect it). The flow's own 200ms entrance rise masks the hard cut. **Escape mid-intro** closes via `close()` without firing `story-viewer-end`, so it does _not_ open the flow — only watching to the end funnels into posting.

**D6 — Scope the story hand-off orchestrator to `[data-story-rail]`.**
`index.astro`'s `story-viewer-end` / `story-viewer-prev` handlers currently query `document.querySelectorAll('[data-story-viewer]')` — which would include the intro viewer (placed after the rail) and let the last rail tile chain _into_ it, or let the intro chain into a rail tile. Both handlers change to `document.querySelectorAll('[data-story-rail] [data-story-viewer]')` so hand-off only ever traverses rail tiles; the intro (outside the rail) is never a hand-off source or target, and its cancelled end event (D5) drives the flow instead.

**D7 — Remove the "Guest story" modal header text; keep the span as a spacer.**
The header row is `flex justify-between` (author left, close button right). Emptying the placeholder's text (rather than deleting the element) keeps a zero-width flex child on the left so the close button stays right-aligned. Applied in both `StoryViewer.astro` (SSR) and `guest-rail.ts`'s `buildGuestModal` twin. This also empties the header for real tiles with a null `firstName` — one code path, acceptable (the couple wants a cleaner unnamed modal).

**D8 — Retire the `guest-wishes` capability; relocate its two non-wish invariants to `guest-photos`.**
`guest-wishes` held: wish validation, wall wish payload, both marquee requirements (all removed with the feature), plus `One submission per invite` and `Submission requires content`. The latter two are submission-level truths independent of wishes, so they move to `guest-photos` (`Submission requires content` → `Submission requires photos`). Rather than leave an empty spec file, the change removes every `guest-wishes` requirement; the capability is retired.

## Risks / Trade-offs

- **Wide test churn.** Every test that fills `[data-wish-input]` or asserts wish payload shape changes. Mitigation: a `seedStoryIntroSeen(page)` helper (init-script `localStorage.setItem`) lets existing flow tests open the flow directly; wish-only scenarios (`wish-only post keeps mocks`, `text-only submit`) are deleted as now-impossible states.
- **Migration is destructive (drop column).** drizzle-kit generates an `ALTER TABLE submissions DROP COLUMN wish_text` (SQLite 3.35+/libsql support it; the `UNIQUE(invite_id)` index is untouched). Zero data risk here (not deployed), but the migration is irreversible in the forward direction — acceptable per the couple's explicit "not deployed, no risks".
- **Public visitors lose the info once the wall is non-empty.** Accepted (D-scope): they cannot post, so the add-story funnel does not apply to them.
- **Intro flag is per-browser.** A guest on a new device sees the intro again; a returning guest who already posted never sees the tile (so never the intro). Both are fine for a one-time how-to.

## Migration

1. Code + schema change land together.
2. `wish_text` drop migration generated via `pnpm --filter @wedding-website/db db:generate` and applied with `db:migrate`; scratch/dev DBs (`local.db`, `.playwright/db.sqlite`) recreate cleanly.
3. No production step — not deployed.
