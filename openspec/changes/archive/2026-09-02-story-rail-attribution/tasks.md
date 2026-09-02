## 1. Payload: first name + timestamp

- [x] 1.1 In `apps/web/src/pages/api/submissions/index.ts`, join `submissions.invite_id` to `invites.display_name` in the wall query and add `firstName` (first whitespace-separated token, `null` when the token derives empty) and `createdAt` (epoch ms) to every `wall.stories` entry and to `mine` when non-null; wishes unchanged.
- [x] 1.2 Update `SubmissionsPayload`/story/mine types in `apps/web/src/lib/submissions-client.ts` with `firstName: string | null` and `createdAt: number`.
- [x] 1.3 Extract StoryViewer's relative-timestamp formatter into `apps/web/src/lib/time.ts` and import it in `StoryViewer.astro` (behavior-identical).

## 2. StoryViewer author block

- [x] 2.1 Relax the modal author-block gate in `apps/web/src/components/StoryViewer.astro` from `username && avatar` to `username`: render the avatar circle only when `avatar` is present and the timestamp only when `timestamp` is present; keep the "Guest story" placeholder when `username` is absent.
- [x] 2.2 Verify tile label/aria parity: a `username`-bearing, avatar-less instance renders the name span and `View <name>'s stories` accessible label (no markup change expected beyond the gate; adjust if the label branch needs it).

## 3. Named guest tiles in the rail script

- [x] 3.1 Extend `buildGuestTile` in `apps/web/src/scripts/guest-rail.ts` to accept `firstName` and `createdAt`: populate the tile label span (or keep the transparent filler when `firstName` is null), set `data-username`, and build the modal author header with name + relative timestamp via `lib/time.ts` (or the "Guest story" placeholder when null).
- [x] 3.2 Thread `firstName`/`createdAt` from the payload through `renderGuestTiles` for both `wall.stories` and `mine` tiles.

## 4. Rail composition in index.astro

- [x] 4.1 Replace `storyUsers`, `storyTeasers`, and `mockStoryUsers` in `apps/web/src/pages/index.astro` with a single array of three unnamed, single-story mock entries (`stories: [{ id, type: "image", src: "/story_example_N.webp", duration }]`, no `username`/`avatar`/`timestamp`), rendered as `StoryViewer` with `mock` under the existing `showMockStoryTiles` gate.
- [x] 4.2 Delete `teaserAssetExists`, the teaser tile markup, and the now-unused `existsSync` import; fix the tile stagger `animation-delay` math for the new single-array rail.
- [x] 4.3 Reserve a min-height on the rail row (one tile row) so a non-empty wall's pre-fetch state doesn't collapse the section.

## 5. Asset cleanup

- [x] 5.1 Delete teaser-only assets: `apps/web/public/story_example_{1,2,3}.jpg` and `story_example_{1,2,3}-640.{avif,webp}` (all unreferenced after teaser removal); grep-confirm no remaining references; keep full-size `.avif`/`.webp`.

## 6. Tests

- [x] 6.1 Rewrite `apps/web/tests/mock-tiles-verify.spec.ts`: unnamed mocks (filler label, no `[data-avatar]`, "Guest story" modal header), one progress item per mock, first slide `src` = `/story_example_1.webp`.
- [x] 6.2 Update `apps/web/tests/guest-rail.spec.ts`: drop demo-tile anchors (`:not([data-guest]):not([data-mock])` selectors, Daniel hand-off), assert named guest tiles (label span text, `View <name>'s stories`), re-anchor hand-off to the mock chain, keep eviction/wish-only/race scenarios.
- [x] 6.3 Update `apps/web/tests/story-viewer.spec.ts`: re-anchor multi-slide navigation and progress assertions to a seeded guest submission with 3 photos (route payload), and hand-off assertions to the single-story mock chain (`story_example_*` srcs).
- [x] 6.4 Update `apps/web/tests/mock-gate-ssr.spec.ts`: remove `public/teasers/` scaffolding and `/teasers/story-teaser` assertions; assert three `data-mock` occurrences on an empty wall and zero `<story-viewer` elements in SSR HTML on a non-empty wall. (Plus a regression test: on a non-empty wall the injected tile is defined, named and openable.)
- [x] 6.5 Run the story-rail test subset (`mock-gate-ssr`, `mock-tiles-verify`, `guest-rail`, `story-viewer`, `placeholder-verify`) green.

## 7. Docs

- [x] 7.1 Update `ops/MODERATION.md` opening line and any no-names wording to reflect first-name attribution on stories (wishes remain anonymous).

## 8. Verification

- [x] 8.1 `pnpm build` passes; `openspec validate story-rail-attribution --strict` passes.
- [x] 8.2 Full Playwright suite green; manual check: empty wall shows 3 nameless example posts; after a seeded real post the rail shows one named tile for public and invitee viewers.
