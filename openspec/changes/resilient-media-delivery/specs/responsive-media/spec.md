## ADDED Requirements

### Requirement: Every raster image declares device-matched candidates

Every `<img>` in **server-rendered markup** that the site delivers for photographic or illustrated content SHALL carry a candidate set offering at least two resolutions and a `sizes` attribute describing the rendered width, so the browser selects bytes matched to the device rather than downloading a desktop-sized asset on a phone. Images injected into the DOM at runtime by a third-party widget — Leaflet tile `<img>`s, and the popup banner `venue-map.ts:123` builds as an HTML string — are outside this requirement's scope and are tracked as a named follow-up rather than silently exempted.

Where an image's presentation size is set by a **CSS transform** rather than by layout, `sizes` SHALL account for the transform rather than being derived from the layout box alone — transforms are invisible to candidate selection, so a layout-derived `sizes` would serve an image presented at several times its layout size from its smallest candidate. The hero follows this with `sizes="min(280vw, 1536px)"` against a `scale(2.8)` transform.

Accounting for the transform does **not** mean claiming the full geometric presentation width. Where an image is perceptually unimportant at its scaled size — fast-moving, peripheral, largely clipped by an `overflow-hidden` container — `sizes` MAY deliberately claim less than geometry would justify, provided the reasoning is recorded in `design.md` and the claim is not later "corrected" upward on geometric grounds alone. The collage exercises this: its centre slot, which ends the sequence covering the stage, claims `min(100vw, 1280px)`, while the nine surrounding slots claim `min(33vw, 390px)` despite being scaled 4–9×. Per-slot values keyed on an existing markup flag are preferred over one global cap when the slots differ this much.

Format negotiation SHALL offer AVIF with a WebP fallback through `<picture>` where the engine supports it, as the existing markup already does. Decorative images under 2 KB, and assets that exist at a single resolution, MAY ship a plain `src`. The ten ZoomParallax collage images are tier-managed under `media-tiering` and are exempt from the live-`srcset` form of this requirement: they carry their full-resolution candidate set deferred until promoted, plus a `sizes` attribute and a live low-fidelity `src`.

No upper bound is placed on the candidate set beyond the no-upscale rule below. A cap tied to rendered width was considered and dropped: it conflicts with the master-as-top-candidate rule for images whose intrinsic width far exceeds their layout box — `keluarga-acik` is a 2048 px master in a card capped at `md:w-[560px]` — and resolving the conflict in favour of the cap would mean re-encoding private masters this change has no mandate to alter. The browser selects by `sizes` and simply never requests the wider candidates; they cost repository bytes, not guest bytes.

#### Scenario: Phone does not pay for desktop pixels

- **WHEN** a guest loads the page on a 390 CSS px viewport at device pixel ratio 2
- **THEN** the family portrait downloads a candidate at or below 780 px wide, not the 2048 px master

#### Scenario: Wide viewport gets the high-resolution candidate

- **WHEN** a guest loads the page on a 1440 CSS px viewport at device pixel ratio 2
- **THEN** at least one image selects a wider candidate than it selects on a 390 CSS px @2x load, from the same `srcset` and with no markup change — not necessarily the widest, since selection follows `sizes` and stops at the first candidate that satisfies it

The subject is existential, not universal, and an assertion that reads it as universal will fail on correct behavior. Two of the seventeen images have masters narrower than the 780 device px a 390 CSS px @2x load demands, so they select their master at _both_ viewports and are evidence neither way: `event-akad` (768 px) and `event-resepsi` (584 px). The discriminating subject is `keluarga-acik`, measured at `-w768.avif` on the 390 @2x leg and `-w1280.avif` on the 1440 @2x leg from one unchanged `srcset`.

#### Scenario: Collage images carry candidate sets

- **WHEN** the ZoomParallax collage markup is inspected in the delivered document
- **THEN** each of the ten collage images carries a `sizes` attribute and, within its `<picture>`, either a live `srcset` or a deferred `data-src`/`data-srcset` candidate set, per its tier

### Requirement: Intrinsic dimensions reserve layout space

Every `<img>` in server-rendered markup SHALL carry `width` and `height` attributes matching its intrinsic aspect ratio, so the space an image will occupy is reserved before its bytes arrive and no image arrival can shift surrounding content. An image whose bytes have not arrived SHALL still occupy its final box. For an absolutely positioned full-bleed image whose box is set by its container rather than by these attributes — the `WelcomeGate` background, and the two `HeroZoom` layers that already follow this convention — the attributes SHALL still declare the true intrinsic dimensions; the layout-reservation rationale does not apply, but a consistent, truthful declaration does.

#### Scenario: Space is reserved before bytes arrive

- **WHEN** the document has parsed but an image response is still in flight on a throttled link
- **THEN** the image box occupies its final width and height and the document height does not change when the image paints

#### Scenario: Markup references a base the step does not cover

- **WHEN** a component names a photographic base that has a master in `apps/web/public/` but is absent from the step's explicit list
- **THEN** the build fails naming that base, rather than delivering a `srcset` whose `/generated/` URLs nothing produced

#### Scenario: A master exists in only one format

- **WHEN** a listed base has an AVIF master but no WebP master, or the reverse
- **THEN** the build fails, because the markup emits a `<source>` for both formats and one of them would name files that do not exist

#### Scenario: Two formats of one base disagree on size

- **WHEN** a base's AVIF and WebP masters have different intrinsic widths
- **THEN** the build fails rather than resizing both with one ladder, which would emit a file named for a width it does not have

#### Scenario: No cumulative layout shift from media

- **WHEN** the page is loaded on a throttled link and scrolled to the bottom
- **THEN** no image arrival produces a layout shift of already-rendered content

### Requirement: Image variants are generated at build time

Resolution and format variants SHALL be produced by a repeatable build-time step committed to the repository, not by hand and not at request time. The step SHALL derive its outputs from the masters present at `apps/web/public/` — repository placeholders in CI, real media locally after `tools/restore-private-media.sh` — SHALL be idempotent for unchanged inputs, and SHALL emit both AVIF and WebP at each configured width. Its input set SHALL be the explicit list of base names the markup actually references, so it emits no **resolution variant** nothing consumes. Placeholder pairs are exempt from that clause and are emitted for every listed base, including bases whose placeholder no markup currently names; the reason is recorded in design D3. Generated assets SHALL live under `apps/web/public/generated/`, which SHALL be gitignored and SHALL NOT be tracked, so derivatives of real private media can never be committed.

The step SHALL bound its own input set by name, and SHALL reject rather than silently skip. No base name may match the pre-existing `wedding_photo*` hero family — its masters, their `-390`/`-640`/`-1024`/`-1536` derivatives, or the `wedding_photo_blur` pair — and none may name a subdirectory or a hidden path. A `-w<digits>` suffix test is not sufficient for this: the hero derivatives are named `-390`/`-640`/`-1024`/`-1536`, which such a test does not match, and they would be re-derived into variants-of-variants. The same name prefixes SHALL filter the base names the step reads back out of the markup, so hand-maintained assets are not reported as uncovered. Non-raster files and anything already under `generated/` cannot enter an explicit whitelist and need no separate exclusion.

The step SHALL cross-check its explicit list against the base names the markup references, and SHALL fail the build when markup names a base that has a master in `apps/web/public/` but is absent from the list. The list is hand-duplicated from the components, so this is the realistic drift: generation would skip the base, the delivered `srcset` would still name `/generated/<base>-w390.avif` from the naming convention alone, and every promoted image in that slot would 404 for the guest. A reference whose master is absent SHALL NOT fail the build, so that the cross-check cannot turn an unrelated string into a spurious failure.

The step SHALL NOT upscale: it emits a width only when that width is **strictly below** the master's intrinsic width, because the master fills that slot and emitting both would declare the same `w` descriptor twice — which the HTML Standard forbids within one element's candidate list, and which would also produce the dead output D3 rejects. Three masters sit exactly on a ladder width: `portrait-bottom-left` 768, `event-akad` 768, `keluarga-yofri` 1280.

Because several masters are narrower than the configured ladder — `square-mid-left` 473 px, `event-resepsi` 584, `awal-perkenalan` 591 — the **master itself SHALL always be the top candidate of its derived set, declared at its intrinsic width**, following the existing hero idiom where `/wedding_photo.avif 768w` sits between the `-640` and `-1024` derivatives. Without this those three sets would contain a single 390 px candidate, violating the two-resolution rule above and _reducing_ the resolution `event-resepsi` ships today. Markup SHALL derive its candidate list from the same two rules, so no `srcset` names a file that was skipped and none declares a duplicate width.

#### Scenario: Variants regenerate deterministically

- **WHEN** the variant generation step runs twice against unchanged masters
- **THEN** the second run produces byte-identical outputs and reports nothing to do

#### Scenario: A new master produces a full candidate set

- **WHEN** a new photographic master is added to the markup **and to the generator's base-name list**, and the generation step runs
- **THEN** AVIF and WebP variants exist for it at every configured width that does not exceed its intrinsic width, at no width above it, and with the master itself offered as the top candidate

### Requirement: The largest contentful paint image is prioritised

The hero image SHALL carry `fetchpriority="high"`, and the document head SHALL carry a `preload` hint for the hero expressed with `imagesrcset`/`imagesizes` mirroring the `<img>` and naming the format the browser will actually choose, so the browser runs for the hint the same candidate selection it will run for the element and the LCP fetch begins during head parsing. A single hard-coded URL SHALL NOT be used: it cannot express a `srcset` selection or negotiate a format, so it would fetch a candidate the `<picture>` then discards. The hint SHALL carry the same `fetchpriority` as the `<img>` it preloads — a preload left at default priority is queued below the head's font preload, and a mismatch between a hint and its consumer is reported by the engine. No other `img` element SHALL carry `fetchpriority="high"`.

#### Scenario: Hero fetch starts during head parsing

- **WHEN** the document head is parsed on a throttled link
- **THEN** a request for the hero candidate is issued before the body's images are discovered

#### Scenario: Priority is not spread across the page

- **WHEN** the delivered document is inspected
- **THEN** exactly one `img` element carries `fetchpriority="high"`, and the head's hero `preload` hint carries the same value

The subject is `img` elements, not occurrences of the attribute. A `<link rel="preload" as="image">` is not an image and is required by this requirement to carry a matching `fetchpriority`, so an assertion that counts attribute occurrences in the document would fail on correct markup.

### Requirement: Below-fold images defer to the browser

Images rendered below the initial viewport SHALL carry `loading="lazy"` so the browser, not a bespoke tier observer, decides when to spend the connection. Images within or adjacent to the initial viewport SHALL NOT carry `loading="lazy"`. The ten ZoomParallax collage images are exempt: `media-tiering` keeps them on the tier's promotion observer because the tier, not the viewport alone, decides which candidate they load.

#### Scenario: Off-screen images are not requested at load

- **WHEN** the page loads on a throttled link and the guest does not scroll
- **THEN** no request is issued for images marked `loading="lazy"` (the collage is excluded, carrying a live placeholder `src` by design)
