## Why

The story rail's placeholder layer is three overlapping fake populations: ten always-on named demo `StoryViewer` tiles, three named mock tiles (`Rara`/`Bima`/`Tania`), and three static teaser tiles that render the same `story_example_*` images as non-interactive `<img>`s under the same empty-wall gate — a redundant third placeholder population. (`mock-gate-ssr.spec.ts` is red for a separate, stale-path reason: it scaffolds and asserts `/teasers/story-teaser-*` files the markup no longer uses.) The couple wants one honest placeholder set instead — their three `story_example_*` images as three nameless preview posts — and, once real memories exist, a rail that says who posted: every real story tile carries the poster's first name for every visitor, because the wall is public and posting is the only invite-gated action.

## What Changes

- Retire the ten demo `storyUsers` tiles and the static `storyTeasers` tiles (plus `teaserAssetExists` and its `existsSync` probe) from `index.astro`; the `story-teaser` capability is retired with them.
- Redefine the three mock tiles: unnamed, avatar-less, timestamp-less, single-story `StoryViewer` tiles built from `/story_example_{1,2,3}.webp`, keeping `data-mock`, the cookie-blind empty-wall SSR gate, and the live client eviction unchanged. Empty wall therefore renders exactly three placeholder posts in line (plus the add-story tile for eligible invitees).
- Add first-name attribution to real story tiles for all visitors (public and invitee): tile label shows the poster's first name; the story modal header shows name + relative timestamp, name-only (no avatar circle). Posting remains invite-gated; wall visibility is unchanged.
- **BREAKING** (additive contract change): `GET /api/submissions` wall stories and `mine` gain `firstName` and `createdAt`; first name is derived at read time as the first whitespace token of `invites.display_name`, omitted when it derives empty. This reverses the D1a no-names decision for stories only — wishes stay anonymous.
- Relax the `StoryViewer` modal author block from `username && avatar` to `username` (avatar circle optional, timestamp optional) so named-but-avatar-less guest tiles get a real author header.
- Delete the now-unreferenced teaser-only assets from the shipped public dir: `apps/web/public/story_example_*.jpg` originals (~5.2 MB) and the `story_example_*-640.{avif,webp}` srcset variants.
- Update the affected Playwright specs (`mock-tiles-verify`, `guest-rail`, `story-viewer`, `mock-gate-ssr`) and the `ops/MODERATION.md` "no-names" wording.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `story-rail-mocks`: mock content becomes three unnamed single-story example tiles (no username/avatar/timestamp, `src` = `/story_example_N.webp`); the "positioned after the demo tiles" placement and the named/avatar/2–3-stories/timestamp author shape are removed; empty-wall gate, live eviction, and honest-preview behavior stay.
- `guest-photos`: real story tiles render the poster's first name for every visitor; the wall payload carries `firstName` and `createdAt` per story and on `mine`; first-name derivation and its empty fallback are specified.
- `guest-wishes`: the "No author attribution anywhere" requirement is scoped to wishes only (responses may now carry story names); wish entries and the marquee remain name-free.
- `story-teaser`: retired — both remaining requirements (demo tiles visible to everyone; couple-supplied static teaser tiles) are removed; the zero-fetch guarantee is moot once the tiles are gone.

## Impact

- `apps/web/src/pages/index.astro` — rail composition (demos/teasers/mocks arrays), gate vars, stagger math, `existsSync` import.
- `apps/web/src/components/StoryViewer.astro` — author-block gate, tile label/aria parity for named guest tiles.
- `apps/web/src/scripts/guest-rail.ts` — `buildGuestTile` gains first name + timestamp (label span, `data-username`, modal author header).
- `apps/web/src/pages/api/submissions/index.ts` + `apps/web/src/lib/submissions-client.ts` — payload join with `invites`, new fields, client types.
- Shared relative-timestamp formatter extracted (StoryViewer internal → importable lib) so guest tiles format `createdAt` identically.
- `apps/web/public/story_example_*.jpg` and `story_example_*-640.{avif,webp}` deleted; full-size `.avif`/`.webp` remain (modal derives siblings by extension swap).
- Tests: `apps/web/tests/{mock-tiles-verify,guest-rail,story-viewer,mock-gate-ssr}.spec.ts`.
- Docs: `ops/MODERATION.md`; synced specs for the four capabilities above.
- Privacy posture: guest first names become publicly visible next to their photos (accepted product decision); wishes and RSVP data unaffected.
