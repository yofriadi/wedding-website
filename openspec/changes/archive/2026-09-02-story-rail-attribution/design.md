## Context

The story rail (`apps/web/src/pages/index.astro`, `#memories-section`) currently stacks three fake populations: ten always-on named demo `StoryViewer` tiles (`storyUsers`), three named mock tiles (`mockStoryUsers`, `data-mock`, gated on `!hasAnyGuestPhoto`), and three static teaser `<img>` tiles (`storyTeasers`, same gate, kept alive by the `teaserAssetExists` probe against `-640.avif` variants) that render the same three images as non-interactive pictures on an empty wall — a redundant third placeholder population. Separately, `mock-gate-ssr.spec.ts` is red because it scaffolds and asserts the retired `/teasers/story-teaser-*` paths — a stale-path test bug independent of the teaser assets' state. Real guest tiles are injected client-side by `apps/web/src/scripts/guest-rail.ts` (`data-guest`, attribution-free, thumbnail-only), and `GET /api/submissions` deliberately carries no names (public-wall D1a; `ops/MODERATION.md`: "Post-once + no-names is the whole moderation story").

The couple's direction: an empty rail shows exactly three nameless example posts built from `public/story_example_{1,2,3}`; the first real photo retires them (machinery already exists: cookie-blind SSR gate + `syncMockTiles` client eviction); and every real story tile shows the poster's first name — to every visitor, since the wall is public and only posting is invite-gated. Modal author header: name + relative timestamp, no avatar.

## Goals / Non-Goals

**Goals:**

- One placeholder population: three unnamed, single-story mock tiles from the `story_example_*` assets; empty rail = exactly these three (plus add-story tile for eligible invitees).
- First-name attribution on real story tiles (tile label + modal header with timestamp) for all viewer classes; payload carries the data.
- Retire demo tiles, teaser tiles, and the `story-teaser` capability by removal; fix the red SSR test by rewriting its stale `/teasers/` scaffolding.
- Keep the existing empty-wall SSR gate and live eviction machinery untouched.

**Non-Goals:**

- Wish attribution (marquee stays anonymous).
- SSR-rendering wall tiles (client injection stays; see D6).
- New asset variants or an image pipeline (mocks reuse existing `.webp`/`.avif`).
- Self-reported display names in the add-story flow.
- Changing posting gates, photo limits, storage, or moderation tooling.

## Decisions

**D1 — Single placeholder population (three unnamed example mocks) replaces demos + teasers + named mocks.**
The couple's "3 post in line" and "left 1 user real post" only hold if every other fake tile goes. Mocks become unnamed (`username`/`avatar`/`timestamp` omitted), single-story (`src: /story_example_N.webp`), keeping `data-mock` so eviction and test classification keep working. Alternatives: keep demos (contradicts both rail states), keep named mocks (contradicts "without name since this is mock").

**D2 — Retire the `story-teaser` capability instead of fixing its asset probe.**
Teasers and mocks share one gate (`!hasAnyGuestPhoto`) and the same assets; two placeholder systems for one job, with the teasers static where the couple wants posts. The `teaserAssetExists` probe and its `-640` variants disappear with the markup; the red SSR test is fixed by the test rewrite (its `/teasers/` scaffolding was stale regardless of asset state). Demo image assets (`/0.webp`…`/18.webp`) stay — hero/parallax/timeline sections use them.

**D3 — First name derived at read time: join `submissions.invite_id → invites.display_name`, take the first whitespace token.**
No schema migration, no snapshot column, no dual-write; admin corrections to `display_name` propagate to the wall. `firstName: string | null` (null when the token derives empty → tile renders attribution-free). Alternatives: snapshot at POST (stale names + migration), self-reported name field (extra UI + a new UGC moderation surface; couple said "just show it"). Accepted trade-off: an invite rename retroactively renames that guest's wall tile.

**D4 — Name-only author UI: relax the `StoryViewer` modal author block gate from `username && avatar` to `username`.**
Avatar circle renders only when an avatar exists; timestamp renders when present. Guest tiles therefore get name + timestamp with no circle; mocks (no username) keep the "Guest story" placeholder and filler label span. Alternatives: initial-letter circle (invents identity), first-photo thumbnail as avatar (duplicates the slide, reads as a profile photo).

**D5 — Extract the relative-timestamp formatter into `apps/web/src/lib/time.ts`.**
StoryViewer's internal formatter (`just now`/`Xm ago`/`Xh ago`/`Xd ago`) becomes importable so client-built guest tiles format `createdAt` identically to SSR tiles. One implementation, two consumers.

**D6 — Wall tiles stay client-injected; SSR renders only empty-wall mocks.**
SSR-ing real tiles from `index.astro` would need reconciliation against `guest-rail.ts`'s re-render on `submissions:posted` (duplicate-tile risk) for marginal gain: the wall fetch is one cached local request. Consequence accepted: a non-empty wall SSRs an empty rail row until the fetch resolves; mitigate with a reserved min-height on the rail row so the section doesn't collapse/jump. No-JS visitors see an empty rail — stories are JS-driven anyway (modal viewer).

Consequence found while applying (and fixed): Astro emits a component's
`<script>` only when that component RENDERS, so "SSR renders StoryViewer only on
an empty wall" also meant the `<story-viewer>` custom-element definition shipped
only on an empty wall. On a non-empty wall `guest-rail.ts`'s injected tiles were
inert markup — no `openStory`, no modal portal, no listeners — and the
un-portaled closed modal's `pointer-events-auto` nav buttons resolved
`position: fixed` against the tile wrapper's fade-up transform, landing on the
tile and swallowing its click. The element therefore lives in
`apps/web/src/scripts/story-viewer-element.ts`, imported by both `guest-rail.ts`
and the component, so the definition ships with the rail script regardless of
SSR state; `mock-gate-ssr.spec.ts` asserts the non-empty-wall client path end to
end (the only spec with a real seeded photo behind a live server).

**D7 — Payload contract: additive fields only.**
`wall.stories[]` and `mine` gain `firstName: string | null` and `createdAt: number`; wishes stay `{ text }`. Client types in `lib/submissions-client.ts` updated in lockstep. Old clients ignore the new fields; rollback is a plain revert.

**D8 — Asset cleanup: delete teaser-only `story_example` variants (`.jpg` ~5.2 MB, `-640.{avif,webp}` ~190 KB).**
The `.jpg` originals and the `-640` srcset variants are referenced only by the teaser markup; all become dead weight once it is gone. Mocks use the full-size `.webp` src (StoryViewer derives the `.avif` sibling by extension swap), so the tile over-fetches a cached file the modal reuses — acceptable without a thumbnail prop. Full-size `.avif`/`.webp` stay.

**D9 — Eviction, gate, and hand-off machinery unchanged.**
`showMockStoryTiles` SSR gate and `syncMockTiles` already implement "first real photo removes mocks everywhere, live". Single-story mocks mean one progress segment; last-slide advance fires `story-viewer-end` and the existing orchestrator hands off to the next mock — the three mocks chain like a real three-post rail.

## Risks / Trade-offs

- [Guest first names become publicly visible next to their photos — reversal of D1a for stories] → Accepted product decision by the couple ("just show it"); limited to first token; wishes stay anonymous; `ops/MODERATION.md` wording updated in tasks so the runbook no longer claims no-names.
- [Empty-rail flash on non-empty walls (SSR has no tiles until fetch)] → Reserved rail min-height; single cached fetch; wall content was already client-injected before this change.
- [Heavy test churn: four specs encode demo tiles and named mocks] → Tasks carry per-spec rewrites: hand-off tests re-anchor to the mock chain and to seeded multi-photo guest submissions for multi-slide navigation.
- [Long first tokens clip in the 80px tile label ("Mochammad")] → Existing `truncate` ellipsis CSS; modal header shows the full token.
- [Invite rename retroactively renames wall tiles (D3)] → Accepted; admin edits are rare and intentional corrections.

## Migration Plan

No database migration. Deploy order irrelevant (payload fields additive; UI reads them defensively with null fallback). Rollback = revert the change commit, which ships the six full-size `story_example_*.{webp,avif}` assets tracked alongside it (review F1: they were untracked when delivered, so a revert without them would leave a fresh clone rendering broken mock tiles AND failing to build `guest-rail.ts`'s `story-viewer-element` import). The deleted `.jpg` originals and `-640.{avif,webp}` variants were NEVER in git, so they are gone for good — regenerate from the couple's source images if a future change ever wants them.

## Open Questions

None blocking. Deferred idea (not in scope): disclose attribution in the add-story flow ("Posting as {firstName}") — revisit if guests ask why their name appears.
