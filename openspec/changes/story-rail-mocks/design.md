# Design: story-rail-mocks

## Context

`guest-submissions` shipped the rail's dynamic behavior: `guest-rail.ts` renders attribution-free guest tiles for invitees and owns add-story tile visibility; `StoryViewer.astro` is a self-initializing custom element that portals its modal to `document.body`; the marquee already has a demo → be-the-first → real state machine. Dogfooding exposed that guest tiles append to the memories `<section>` instead of the rail (wrong ancestor lookup), and the product wants the empty wall to show mock content. Adversarial review added: the Playwright suite's rail locator masks the bug, the invitee's own tile vanishes on reload, tile removal leaks scroll-lock + timers, `data-mock` can't reach `<story-viewer>` through a non-spreading component, and the force-close identifiers aren't in `disconnectedCallback`'s scope.

## Goals / Non-Goals

**Goals**: guest tiles always land inside the rail (and a test that would have caught it); post-submit re-sync reflects the true payload; own tile persists across reloads; tile removal is side-effect-free; an empty wall shows three clickable mock stories to everyone; wish-input placeholder rotates writing prompts politely.

**Non-Goals**: reordering real guest tiles; changing add-story tile visibility or post-once; touching the marquee's demo set; new image assets; demo-tile cleanup.

## Decisions

### D1 — Rail targeting: explicit hook, not DOM traversal

Add `data-story-rail` to the rail's flex container in `index.astro` (the `flex gap-2 overflow-x-auto pb-2 no-scrollbar snap-x px-6` div). `guest-rail.ts` replaces `findRail()`'s heading-text + `parentElement.parentElement` walk with `document.querySelector("[data-story-rail]")`.

Root cause of the bug: `h2.parentElement` is the heading's wrapper div (`mx-auto max-w-7xl px-6`), so the second `parentElement` lands on `<section id="memories-section">` — one level too far. Appending there produces block-level tiles stacked _below_ the rail.

**Test debt (the reason the bug shipped)**: `guest-rail.spec.ts` defines `RAIL` as `section:has(h2:text-is('Show Our Memories Together'))` — the section — so every `${RAIL} [data-guest]` assertion passes whether tiles land in the rail or below it. Retarget the locator to `[data-story-rail]` and add a direct-descendant assertion. The same stale locator also lives in `apps/web/tests/rail-helpers.ts` — a dead file with zero importers; delete it.

### D2 — One render function; wall + own tile on both paths

`guest-rail.ts` gets a single render path used by initial load AND `submissions:posted`: clear existing `[data-guest]` tiles, append `wall.stories` (cap 30) followed by `mine`'s tile. The `guestTilesRendered` flag goes away (clear-then-render is idempotent).

Two defects this fixes:

1. **Post-submit**: `onPosted` currently re-adds only `mine` — other guests' tiles vanish until reload; a wish-only post wipes every guest tile.
2. **Initial load**: `renderGuestTiles` renders `wall.stories` only, and the API's `wall` excludes the caller — so a posted guest's own tile disappears on reload. This becomes user-visible the moment mocks exist: if the only real story is the caller's own, SSR omits mocks (D4 gate) and the client renders an empty wall — a rail with _no_ guest content at all. Rendering `mine` on load closes that dead state.

The refactor is genuinely trivial: `buildGuestTile(photos)` (`guest-rail.ts:39`) is already what both the wall loop and `onPosted` call, and `mine.photos` has the same shape as `wall.stories[].photos` (`api/submissions/index.ts:110-113`). No divergence.

Ordering note: real guest tiles still append _after_ demo/teaser tiles (unchanged from the guest-photos spec). `document.querySelectorAll("[data-story-viewer]")` hand-off order in index.astro's orchestrator stays correct because custom elements remain in the rail in document order (only modals portal to body).

`RAIL_TILE_CAP` is misnamed — it's the wall cap (`slice(0, 30)`), not a rail cap. Rename to `WALL_TILE_CAP` and refresh the budget comment (10 demos + ≤3 teasers + 3 mocks + 30 wall + 1 own).

### D3 — Tile removal force-closes first

`StoryViewer` portals `[data-modal]` to `document.body` at init; `open()` sets `document.body.style.overflow = "hidden"` (restored only in `close()`); `startImageProgress` runs a 50ms interval cleared only by `clearProgress()`. Today's `disconnectedCallback` removes only the keydown listener — so removing a tile already leaks the modal, and removing one whose modal is _open_ would leave the body permanently scroll-locked with a timer dispatching `story-viewer-end` from a detached node. D6's eviction makes this reachable.

**Implementability constraints (round-two review)**: `disconnectedCallback` is a class method; `clearProgress()`, `currentSlideEl`, and `modal` are `init()`-closure locals and are **not** reachable from it. The modal is portaled to `document.body`, so `this.querySelector("[data-modal]")` returns `null` after init. The only handles the class has are `this.#keydownHandler` and `this.openStory`/`this.closeStory` (assigned at `init()`'s end, `:675-676`).

The correct shape: in `init()`, store the modal on the element (a `#modal` private field). Then `disconnectedCallback` does:

```ts
this.closeStory({ animate: false });
this.#modal?.remove();
window.removeEventListener("keydown", this.#keydownHandler);
```

`close()` (`:634-671`) already runs `clearProgress()`, restores `document.body.style.overflow`, and removes `currentSlideEl`, and it early-returns when `!isOpen` (`:636`) so a never-opened tile is a safe no-op — which is exactly why the modal removal must be _outside_ the close call. Null tolerance is required: a tile whose `init()` bailed early (missing/empty `[data-stories]`, `:316-327`) has `closeStory` = the default no-op and no stored modal.

### D4 — Mock gate: uniform (cookie-blind) existence check — all mocks disappear on the first real story

Mocks are a **"coming soon" placeholder that yields to real content** — product decision (locked): **all mocks disappear for everyone, public included, the moment the first real guest story exists.** The SSR gate is therefore **uniform and cookie-blind**: render mocks when `submission_photos` is empty; omit them for all visitors once any row exists.

**Consequence, stated knowingly (product-accepted)**: the first real photo submission removes mocks from the _public_ rail too, and since the public never receives real guest tiles, the public rail returns to teasers + demos. That is the intent — real content supersedes the placeholder, and real content arriving is the goal. It is not a bug or side effect.

**Superseded (public-wall change)**: the second half no longer holds — with the public wall the public DOES receive real guest tiles, so after mock eviction the public rail renders the real wall tiles anonymously (teasers + demos retire too, per the public-wall D4 teaser gate).

On DB error, **fail open** (render mocks): a DB outage already degrades the page to the anonymous state, and the client fetch fails too. (Fail-open is also the default test condition: the Playwright scratch DB is empty/absent, so mocks are present in every test run — selectors must be mock-aware, D5/D9.)

**Cost acknowledged**: the invitee branch adds a DB read on every request, including public ones — today `index.astro` only queries when the cookie shape is valid. Acceptable at wedding scale.

Eviction (for invitees) is triggered by **stories** (a submission with ≥1 photo), not submissions: a wish-only post creates no story tile, so mocks stay. This mirrors the marquee's per-content-type rule (demo wishes evict on real _wishes_). The public never runs `loadSubmissions`, so for the public the SSR gate alone governs (mocks present iff the wall was empty at render).

**Superseded (public-wall change)**: the public now runs `loadSubmissions` too (one shared fetch per load), so eviction runs for every visitor; the SSR gate remains the initial decision.

Public sees mocks while the wall is empty — deliberate. The teaser message ("you will see people's stories here") already addresses invitees-to-be; mocks extend the existing demo fiction rather than contradict it.

### D5 — Mock composition, marking, and tail placement

Three mock tiles, rendered as real `StoryViewer` components (username + avatar, like the demo tiles — product decision), each with 2–3 stories drawn from the existing `/0–18.webp` pool. Being real components means click-to-open, progress bars, gestures, keyboard nav, and rail hand-off all work — the preview _is_ the feature. No new assets ship.

- **Marker on the element**: `data-mock` sits on the `<story-viewer>` element itself, matching `data-guest`. **Requires a component change**: `StoryViewer.astro` destructures exactly five props with **no `...rest` spread** (`:21`), so `<StoryViewer data-mock … />` would silently drop the attribute. Add an explicit `mock?: boolean` prop → `data-mock={mock ? "" : undefined}` on the `<story-viewer>` element. (Contrast `StarButton.astro`, which spreads `...rest`.)
- **Each mock needs a `timestamp`** (e.g. a recent ISO string): demos pass `timestamp="2026-02-03T16:45:00Z"` and an omitted one leaves `[data-timestamp]` visibly empty — a parity break against the tiles mocks are meant to be indistinguishable from.
- **Each mock needs its own wrapper div** (`snap-center flex-shrink-0 animate-fade-up`): D6's removal walks `parentElement` from the `<story-viewer>` element, so if a mock were mapped directly into the flex row without a per-tile wrapper, `parentElement` would be the rail container and eviction would delete the entire rail. The wrapper is load-bearing, not just styling.
- **Placement: after the demo tiles (tail), not the head.** Mocks occupy the exact slots real guest tiles will take — eviction is replacement-in-kind, not removal of a special zone. Tail placement keeps `story-viewer.spec.ts`'s positional selectors (`.first()` / `.nth(1)` on demos) green, needs no entrance-stagger renumbering (mocks simply continue the `(teasers + demos + index) × 60ms` sequence), and avoids reshuffling the teaser→demo narrative at the head. The visibility cost (13 tiles deep) is accepted _because_ mocks are deliberately demo-indistinguishable (R3): head placement would show visitors nothing the demos don't already show.
- Mock data lives **inline in `index.astro`'s frontmatter** (the `storyUsers` precedent), as couple-editable data. Suggested names: Indonesian nicknames (Rara / Bima / Tania). Keep mock slides off `/4.webp` and `/7.webp` (the hand-off assertions are modal-scoped and can't truly collide, but avoiding the filenames removes transient two-visible-modal flake; a nicety, not load-bearing).

### D6 — Live eviction, two trigger points

`guest-rail.ts` gains `syncMockTiles(data)`: remove all `[data-mock]` tiles (wrapper via `parentElement`, through D3's leak-free path) when the payload contains any real story — `wall.stories.length > 0 || (mine?.photos.length ?? 0) > 0` (the `?? 0` is required — bare `mine?.photos.length > 0` is `TS18048` under strict mode). Called (a) after the initial `loadSubmissions()` (covers the race where someone posted between SSR and the client fetch) and (b) on `submissions:posted` after the refetch (covers the posting guest's own session without a reload).

As shipped this ran for invitees only — the public made no requests. **Superseded (public-wall change)**: the public fetches the payload too, so every visitor runs this path; for the public, `mine` is always null and only wall stories trigger eviction.

### D7 — Rotating wish placeholder, politely

While the flow is open and the wish input is empty, `[data-wish-input]`'s `placeholder` cycles through couple-curated templates on a ~4s interval. Constraints:

- Every template ≤ 30 UTF-16 code units (the wish `maxlength`; suggesting an untypeable wish would be a lie). All six starter templates verified ≤ 28 units.
- **One pass, then settle**: each flow open plays through the list once and rests on the default "Write a wish…" — no perpetual auto-updating content (WCAG 2.2.2 territory).
- **First keystroke disables** rotation for the rest of the page session (a `hasTyped` latch; clearing the field does not resume it). Once someone is writing, suggestions stop competing.
- The timer starts in `openFlow()` (clearing any existing interval first — the add-story button stays focusable behind the modal, so double-open must not stack timers) and stops in `closeFlow()`.
- `prefers-reduced-motion` → static default, no interval.
- Accessibility claim, precisely scoped: the field's accessible **name** is constant (`aria-label="Wish"`, `AddStoryFlow.astro:89` — the placeholder does not contribute to it); the rotation is bounded + self-terminating per the rules above.
- **`closeFlow()` clears photos but NOT `wishInput.value`** (`add-story-flow.ts:162-171`), so a reopen can begin with a non-empty field. Rotation must not run on a non-empty input (spec already covers this), and `hasTyped` correctly stays latched — the text the guest typed earlier is still there, so they "have typed".
- Starter set (couple edits freely): "Happy ever after! ✨" / "To a lifetime of joy!" / "May love always find you" / "Grow old together 💛" / "Selamat menempuh hidup baru!" / "Bahagia selalu, kalian!" — all ≤ 28 units.

The marquee's five demo wishes stay untouched — they serve a different surface (ambient texture vs. per-person prompt).

### D8 — Archive ordering

`guest-submissions` is complete but unarchived; `guest-photos` and `add-story-flow` specs don't exist in `openspec/specs/` yet. Archive `guest-submissions` **before** this change so both deltas apply to a real base. Reconcile `story-teaser`'s stale requirements (it asserts no add-story tile exists) at that archive — not in this change.

### D9 — Test impact

- `guest-rail.spec.ts`: retarget `RAIL` to `[data-story-rail]` (D1); make selectors mock-aware (`:not([data-mock])` where "demo" tiles are counted); give the DOM-order check a real three-way classification (teaser / demo / mock / guest — today every non-`[data-guest]` story-viewer is labeled `"demo"`, so mocks would classify as demos). New coverage: empty scratch DB → mocks present (public, zero submissions requests), eviction on photo post, persistence on wish-only post, own-tile reload persistence.
- `story-viewer.spec.ts`: unchanged — tail placement keeps `.first()` / `.nth(1)` on demo tiles and the `/4.webp` / `/7.webp` hand-off assertions valid (those are modal-scoped).
- Delete `apps/web/tests/rail-helpers.ts` (dead, zero importers, carries the stale locator).
- Close-out adds `pnpm check-types` + production build (venue-map-routes 5.12 / rsvp-live-count 5.2 precedent).

## Risks / Limitations

- **R1 — SSR/client gate skew**: between SSR (empty) and the client fetch (someone posted), an invitee sees mocks briefly. Mitigated by D6(a); the rail sits below the fold behind the loader (≥2.6s dwell) + welcome gate, so eviction lands before first view in practice. For the public there is no client-side correction — the SSR gate decides, so mocks reflect the wall state at page render.
- **R2 — Fail-open on DB error** (D4) means an outage shows mocks to visitors who might otherwise have seen real tiles — but in an outage the client fetch fails too, so no real tiles would render regardless.
- **R3 — Mocks are indistinguishable from the ten named demos** (same component, same photo pool — product-accepted, including from _real_ guest stories). Consequence: mocks don't advertise a _new_ kind of content; they fill the rail with the couple's photos and hold the slots real guest stories will take. If the couple later wants the guest-story slot to read as such, the honest treatment is attribution-free "Guest story" styling (declined for now) — marking and placement can be revisited together.
- **R4 — Placeholder rotation is auto-updating text**: bounded by one-pass settle + stop-on-first-keystroke + reduced-motion static (D7). It remains motion-adjacent content on a focused field; if it ever feels busy, the escape hatch is dropping rotation to the static default.
- **R5 — In-flight hand-off into an evicted mock**: if a mock is removed while it is the _incoming_ viewer of a hand-off, the 800ms fallback (`index.astro:420-427`) still closes the outgoing viewer, dumping the visitor to the page with no modal. D3's force-close restores scroll lock, so it's cosmetic — a dismissed viewer, not a stuck one. Accepted; noted here so it isn't mistaken for a leak.
