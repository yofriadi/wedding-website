# Proposal: story-rail-mocks

## Why

Dogfooding the guest-submissions flow surfaced one user-visible bug and one missing state:

1. **Guest tiles render below the rail, not in it.** `guest-rail.ts` locates the rail by walking `h2.parentElement.parentElement` up from the "Show Our Memories Together" heading — that lands on the `<section>`, not the flex rail container. Every dynamically added guest tile (initial wall render and post-submit) appends as a block child after the rail, so uploaded photos appear _underneath_ the story list instead of inside it. The bug survived CI because `guest-rail.spec.ts`'s `RAIL` locator also matches the section, not the rail row.
2. **An empty wall has nothing to show.** Before the first guest posts photos, the rail's guest-story slots don't exist yet, and there is no preview of a full, photo-rich rail.

Latent defects riding along: the post-submit re-sync removes all guest tiles but re-adds only the caller's own (other guests' tiles vanish until reload); the invitee's own tile never renders on initial load (post → reload → own tile gone); and removing any tile leaves its body-portaled modal, a live progress interval, and a scroll-locked body behind.

## What Changes

- **Fix rail targeting**: put a `data-story-rail` hook on the rail's flex container in `index.astro`; `guest-rail.ts` queries it directly. The heading-text + `parentElement` traversal is deleted, and the Playwright locator that masked the bug is retargeted to the same hook.
- **Fix post-submit re-sync**: after a successful POST, rebuild the guest tile set from the fresh payload (wall + own tile), not just the caller's tile.
- **Render the invitee's own tile on initial load**: `mine`'s tile joins the wall tiles on first render, so a posted guest's tile survives reload — and the sole-submitter rail is never empty.
- **Fix tile-removal cleanup**: removing a `<story-viewer>` tile force-closes it first (progress interval cleared, body scroll restored) and removes its body-portaled modal.
- **New: mock story tiles for the empty wall**: three named, clickable mock `StoryViewer` tiles server-rendered for everyone (public + invitees) while zero real guest stories exist, placed after the demo tiles — occupying the slots real guest tiles will take. Evicted on the first real photo submission: by SSR on the next page load, and live (no reload) for the posting guest's session.
- **New: rotating wish placeholder**: while the add-story flow is open and the wish input is empty, the placeholder cycles through short template wishes (each within the 30-char wish limit) as writing prompts — one pass, then it settles; the first keystroke disables it.

## Non-goals

- **Reordering real guest tiles** — they still render after the demo/teaser tiles (guest-photos spec unchanged on that point).
- **Add-story tile visibility rules** — `mine === null` hiding works correctly today; untouched.
- **The wish marquee's demo wishes** — the existing five stay as-is (per product decision); only the flow's input placeholder rotates.
- **Replacing the ten demo tiles** — mocks are additive, not a demo cleanup.
- **New photo assets** — mocks reuse the existing `/N.webp` pool; the couple can swap later.

## Capabilities

### New Capabilities

- `story-rail-mocks`: Empty-state mock story tiles — SSR gating on real-story existence, composition (named, clickable), placement, and live eviction on the first real story.

### Modified Capabilities

- `guest-photos`: the anonymous-rail scenario now includes mock tiles while the wall is empty; new requirements for rail-container placement and own-tile-on-initial-load.
- `add-story-flow`: adds the rotating wish-placeholder requirement.

NOTE: both modified capabilities' base specs land in `openspec/specs/` when the completed `guest-submissions` change is archived; archive `guest-submissions` before this change so the deltas have a base. (`story-teaser`'s archived spec is already stale relative to `guest-submissions` — it still asserts the add-story tile does not exist — reconcile it at that archive, not here.)

ARCHIVE ORDER (updated by the public-wall change): archive order remains `guest-submissions` → `story-rail-mocks` → `public-wall`. `public-wall`'s deltas MODIFY the requirements this change adds, so this change must archive before `public-wall`; the superseded public-rail statements above are reconciled at this archive and finalized by `public-wall`.

## Impact

- **Code**: `apps/web/src/pages/index.astro` (rail hook, mock SSR + gate query, mock data), `apps/web/src/scripts/guest-rail.ts` (targeting, shared render, own-tile, mock eviction), `apps/web/src/components/StoryViewer.astro` (force-close on disconnect), `apps/web/src/scripts/add-story-flow.ts` (placeholder rotation).
- **Tests**: `apps/web/tests/guest-rail.spec.ts` (rail locator retargeted to `data-story-rail`, mock-aware selectors, eviction + reload-persistence coverage), `apps/web/tests/story-viewer.spec.ts` (unchanged by design — tail placement keeps its positional selectors green; asserted in tasks). `pnpm check-types` + production build added to close-out.
- **API/DB**: no endpoint or schema changes; one cheap SSR existence check on `submission_photos` (`LIMIT 1`).
- **Public privacy posture**: unchanged at this change's scope — mocks are static SSR markup. (Superseded since: the public-wall change retires the public zero-request guarantee — one shared submissions fetch per load, wall served anonymously.)
- **Risk**: low. The rail fix restores intended behavior; mocks are decoration with a server-side gate; the eviction path reuses the existing `submissions:posted` re-sync.
