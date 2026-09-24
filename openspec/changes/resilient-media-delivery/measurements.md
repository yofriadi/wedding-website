# Measurements — resilient-media-delivery

Recorded during implementation, against the **production build**
(`pnpm --filter web run build`, then `node dist/server/entry.mjs`) on
`127.0.0.1:4400`. Real private media was overlaid
(`tools/restore-private-media.sh`), so these are the binding numbers, not
placeholder-derived ones.

### Units, stated up front

Two kinds of number appear below and they are not interchangeable. **Transfer**
figures come from `response.transferSize` (or `body.length` plus headers) and
carry HTTP framing and, where applicable, compression. The only genuine transfer
figure quoted for a variant in this file is **`keluarga-acik` at 39.4 KB** on the
390 @2x leg.

**On-disk** figures are `statSync().size` in `public/generated/` or `public/`: the
generator's `largest generated variant` and `largest LQIP`, the two-leg table's
25.2 KB / 179.6 KB, and — contrary to an earlier version of this section, which
listed them as transfer — `keluarga-acik` **39.1 KB / 93.1 KB** and
`square-top-right.avif` **317.6 KB**.

The two reconcile, and showing the arithmetic is the point of this section:
`keluarga-acik-w768.avif` is 40 078 B = **39.1 KiB on disk** and **39.4 KB
transferred**, the 0.3 KB being ~270 B of response headers. `center-focus-w1280.webp`
is 183 918 B = 179.6 KiB. `square-top-right.avif` is 325 238 B = 317.6 KiB, which
an earlier draft rounded to 318 and elsewhere to 317.9 — both the same file.

### Provenance, stated plainly

**The instrument is not in the repository.** Every number below came from ad-hoc
Playwright scripts written to `/tmp` during the implementation pass and not
committed; task 6.1 defers committing the throttled harness, and the operator's
instruction for this pass was to defer every task that writes or runs tests. So
these figures are _measured once, by an instrument nobody else can currently run_
— which is weaker than this file's own standard ("so the numbers are reproducible
rather than anecdotal") and is stated here rather than left implicit in fourteen
task notes that cite it.

Two things mitigate it. Every probe is reproduced below in full, so the numbers
can be re-derived by hand from a browser console without the harness. And the
candidate-selection figures are independently checkable by arithmetic from the
shipped `sizes` strings and the real master widths, which review did:
390 @2x centre → 1280w, outer → 390w, `keluarga-acik` → 768w,
`awal-perkenalan` → 390w, `keluarga-yofri` → 768w all reproduce exactly, and
30 LQIP + 54 variants = the claimed 84 with 90 configured − 54 emitted = the
claimed 36 skipped.

The probes used, verbatim:

```js
// Document inventory — run in page context after `waitUntil: "load"`.
const imgs = [...document.querySelectorAll("img")];
imgs.length; // 17
imgs.filter((i) => !i.getAttribute("src")).length; // 0
imgs.filter((i) => !i.complete || i.naturalWidth === 0).length;
document.querySelectorAll("#zoom-parallax-container img[data-promoted]").length;
[...document.querySelectorAll("[data-scroll-fade]")].filter(
  (e) => getComputedStyle(e).opacity === "1",
).length; // 9 of 9, JS off
// Which candidate the engine actually chose, per image:
img.currentSrc.split("/").pop();
// Overlay floor — an element covering the viewport traps a no-script guest:
document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("main, #hero-container");
getComputedStyle(document.getElementById("loading-screen")).display; // "none", JS off

// Byte figures — read `transferSize` from the resource-timing entries (or
// `response.headersSize() + body.length`), NOT body length alone. The three font
// files are 67304 + 81520 + 29400 = 178224 B of body; the recorded 179124 B is
// 900 B more, which is exactly 3 x ~300 B of response headers. `transferSize` is
// the correct metric for the spec's "total font payload transferred", but a reader
// summing bodies gets 178224 and concludes the artifact is wrong.
// Filter by URL in a context created with { viewport: {width:390,height:844},
// deviceScaleFactor: 2 }. Fonts: /_astro\/.*\.woff2?$/ → 3 requests, 179124 B.
// `loading="lazy"` legs: assert 0 of 5 complete at rest, then scroll
// body.scrollHeight in 400 px steps and assert all resolve.
```

Font byte total is the sum of transferred bodies for the three requests
`fraunces-latin-standard-normal`, `fraunces-latin-standard-italic` and
`geist-latin-wght-normal`; the `vietnamese`, `cyrillic` and legacy `.woff` counts
are zero in the request list and `dist/client/_astro/` contains 11 `.woff2` and
no `.woff`, so the "no legacy woff is requested" scenario cannot fail.

Baseline for comparison is `design.md`'s Context table: DCL 4501 ms, 2.66 MB
transferred, 293 KB of fonts across 3 requests, 10 of 17 images sourceless,
1 of 19 `<img>` with a `srcset`, largest image 463 KB.

## Fonts (tasks 1.4, 1.5, 1.6)

**179 124 bytes transferred across 3 requests** on a 390 CSS px viewport, empty
context, latin-only render. Body bytes 178 224; the 900 byte difference is
response headers.

| file                             | transferred                          |
| -------------------------------- | ------------------------------------ |
| `fraunces-latin-standard-normal` | 67 604 b                             |
| `fraunces-latin-standard-italic` | 81 820 b                             |
| `geist-latin-wght-normal`        | 29 700 b                             |
| **total**                        | **179 124 b (174.9 KiB / 179.1 KB)** |

- Budget fixed by task 0.2 is **≤ 200 KB**. Passes on either reading of the unit
  (174.9 KiB, 179.1 KB decimal). **Baseline 293 KB → 179 KB, −39 %.**
- Identical on the 1440 @2x leg: viewport does not change the font set.
- Requests, not declarations, were counted. `vietnamese` requested: **0**.
  `cyrillic` requested: **0**. Legacy `.woff` requested: **0** — and none is even
  emitted: `dist/client/_astro/` contains 11 `.woff2` files and no `.woff`, so
  the `webfont-delivery` "No legacy woff is requested" scenario cannot fail.
- Loaded faces at runtime, exactly three: `Geist Variable/normal`,
  `Fraunces Variable/normal`, `Fraunces Variable/italic`. No `Geist` and no
  `Fraunces` static family is declared anywhere in the emitted CSS (task 1.2/1.3).
- **`font-display: swap`: 11 `@font-face` rules emitted, 11 carry it**
  (`dist/client/_astro/index.C59do8XA.css`). No override was needed and none was
  added; no `size-adjust`/`ascent-override` faces were introduced (task 1.5).
- `latin-ext` is retained but was **not** requested on this render — the test
  guest name is latin-only. It costs 16 512 b only when a `unicode-range` matches.

### Task 0.1 — the ampersand after the `standard` entrypoint

Measured rather than eyeballed, at 1440 @2x with the gate dismissed:

- `.animate-amp` computes to `"Fraunces Variable", serif`, `font-style: italic`,
  `font-size: 120px`, `font-optical-sizing: auto`.
- Its rendered advance is **70.08 px**, against a canvas measurement of
  **69.59 px** for `&` in `Fraunces Variable` and **93.34 px** in generic `serif`.
  The glyph came from Fraunces, not from a fallback.
- **`opsz` is measurably doing work**: the advance-per-em ratio for `&` is
  **0.6844 at 16 px** and **0.5799 at 120 px** — a 15 % difference in glyph
  proportion between text and display sizes. That is the 65 KB the owner chose
  to spend, and it is not notional.
- At 390 CSS px the ampersand is 44.85 px, still italic Fraunces, still `auto`.

> These were measured, not looked at. A human eyeball on the hero at both
> viewports is still worth having, but the numbers above establish what "renders
> as expected" was asked to confirm: the intended face rendered, in the intended
> style, with the axis the 65 KB was spent on measurably active.

## Candidate selection (tasks 0.3, 5.1, 5.9)

`currentSrc` per `<img>`, at rest, after the loader and gate dismissed.

| slot              | 390 CSS px @2x                       | 1440 CSS px @2x                    |
| ----------------- | ------------------------------------ | ---------------------------------- |
| hero              | `wedding_photo-1536.avif` (182.4 KB) | `wedding_photo-1536.avif`          |
| hero blur         | `wedding_photo_blur.webp`            | same                               |
| collage × 9 outer | `<base>-w390.avif`                   | `<base>.avif` (the master)         |
| collage centre    | `center-focus-w1280.avif` (108.5 KB) | `center-focus.avif` (1920w master) |
| timeline × 3      | **not requested** (`loading="lazy"`) | **not requested**                  |
| events × 2        | **not requested** (`loading="lazy"`) | **not requested**                  |

After a full scrolled pageview at 390 @2x the lazy five resolve to:
`awal-perkenalan-w390.avif`, `keluarga-yofri-w768.avif`, **`keluarga-acik-w768.avif`
(39.4 KB)**, `event-akad.avif` (768w master), `event-resepsi.avif` (584w master).

- **Task 5.9's MUST holds: `keluarga-acik` was never requested at 2048 px** on
  the measured leg — 39.4 KB instead of the 462.9 KB master, a **12× reduction**,
  and the change's largest single byte win.
- **No generated candidate exceeds 200 KB on the measured leg.** Largest
  generated file requested at 390 @2x: `center-focus-w1280.avif` at 108.5 KB.
  Largest generated file on disk: **179.6 KB = `center-focus-w1280.webp`**
  (183 918 B), derived from the 1920 px `center-focus` master. It is a **WebP** —
  the format the ≤ 200 KB ceiling's own prose never mentions — and the margin is
  **20.4 KB, or 10.2 %**, not the ~2x headroom a reader would infer from the
  attribution an earlier version of this line made. Next largest:
  `square-top-right-w768.webp` 147.3 KB, `keluarga-acik-w1280.webp` 140.4 KB,
  `center-focus-w1280.avif` 108.2 KB. That earlier version named
  `square-top-right-w768.avif`; the file is **95.4 KB** (97 653 B from a 317.6 KB
  master). The error was possible because the generator reported a size with no
  name attached, and is now structurally impossible: it prints
  `largest generated variant: <name> <size> (ceiling 200 KB, <n> over)`, measured
  over every variant on disk including the ones `isFresh()` short-circuits. The hero's `wedding_photo-1536.avif` at 182.4 KB remains the binding
  floor exactly as task 5.9 predicted, and is untouched by this change.
- **The wide leg selects a wider candidate from the same `srcset`** with no
  markup change (1920w master vs 1280w generated for the centre; 1024w master vs
  390w generated for the outer nine) — the `responsive-media` "Wide viewport"
  scenario.
- Task 5.9's accepted desktop case is confirmed: at 1440 @2x the outer
  `min(33vw, 390px)` resolves to 780 device px, and for a 1024 px master that
  selects **the master** (`square-top-right.avif`, 317.6 KB) rather than a
  generated candidate, because 768w falls 12 px short. This is **tier-independent**,
  not a fast-connection cost: candidate selection is a function of `sizes` and DPR
  alone, and the tier decides only _whether_ promotion happens, never _which_
  candidate the promoted `srcset` resolves to. A `lite` guest at 1440 @2x who
  scrolls within the promotion margin pays it too. This line previously read
  "Fast-connection `full` tier only" — the claim `tasks.md` 5.9, `design.md` OQ3
  and `follow-ups.md` §4 all identify as false. The correction had been applied to
  those three and missed the one file that holds the measurement.
- All ten collage slots painted real content after promotion — per-slot canvas
  sampling gives mean luminance 89–141 and standard deviation 43–72, with
  `complete === true` on every one. No flat or broken frame.

### One prediction in the artifacts is wrong, and the measurements show it

Tasks **0.3** and **5.9** both state that at 390 CSS px @2x the centre slot
"resolves to the **768w** candidate". It resolves to **1280w**.

`sizes="min(100vw, 1280px)"` is 390 CSS px at that viewport; DPR 2 makes the
demand **780 device px**, which is 12 px past the 768w candidate, so the engine
takes the next one. The prediction compared the `sizes` value against the ladder
without applying the device pixel ratio — the same omission the outer slots
escape, because `min(33vw, 390px)` resolves to 128.7 CSS px → 257 device px,
comfortably inside 390w.

**No normative number is violated and nothing was retuned.** The resolved
decision (`min(100vw, 1280px)`, task 0.3) is implemented verbatim; the centre
cap is still what bounds 5.9; the hero is still the largest single asset on the
leg; and the centre image is the slot that ends the sequence covering the whole
stage, so 780 device px of demand there is real rather than accidental. The
outer-nine half of the prediction is correct as written. Recorded here and in
`design.md` Open Question 3 so the next reader is not misled.

## Progressive enhancement (tasks 3.2, 3.7)

**JavaScript disabled**, 390 @2x:

- 17 `<img>` elements in the delivered document — the same 17 as with scripting.
  **0 without a `src`. 0 that failed to decode** (`complete === true` and
  `naturalWidth > 0` on all 17, including the ten collage placeholders).
- All **9** `[data-scroll-fade]` participants at computed **opacity 1**, with
  **0** inline opacity writes — nothing ran, so nothing darkened.
- **No overlay covers the viewport.** `document.elementFromPoint` at the centre,
  both edges and the top of the viewport returns `img < picture < div <
#hero-container < main` on every probe. `#loading-screen` is still in the DOM
  (suppression, not inversion, as the requirement specifies) but is
  `display: none`, and `#welcome-gate` is hidden by its own pre-existing
  `<noscript>`.
- Document height 19 001 px vs 21 538 px with scripting — the difference is the
  collage runway collapsing from 400lvh to one viewport, which is the intended
  no-script behavior and predates this change.

**Scripted path unaffected** (task 3.2): on the 390 and 1440 legs
`#loading-screen` is **absent from the DOM** after load — it faded and was
removed by `doHideLoadingScreen` exactly as before — and the gate still opens on
a swipe-up. `<noscript>` content is ignored and `@media (scripting: none)` does
not match, so neither escape touches it.

## Tier behavior (context for tasks 6.4, 5.9)

- Good 3G (1.6 Mbps / 750 Kbps / 150 ms) at 390 @2x: `data-tier` resolves to
  **`lite`**, **0** collage images promoted, and **0** images without a `src` —
  i.e. ten blurred placeholders instead of ten empty frames, which is the whole
  point of the MODIFIED `media-tiering` delta. The ten `-lqip.avif` files are the
  only collage bytes requested.
- Unthrottled localhost: `data-tier` resolves to `full`, all **10** collage
  images carry `data-promoted`, and the parse-time inline promoter fired.
- Placeholder cost on a lite tier, measured: 10 AVIF LQIPs, **3.27 KB total**
  (3 352 B; largest `square-mid-left-lqip.avif` at 382 B = **0.37 KB**) against
  the 4 KB-per-file cap. The largest of all 30 AVIF placeholders is
  `awal-perkenalan-lqip.avif` at 388 B = 0.38 KB, matching the two-leg table's
  local column. An earlier draft of this line said 0.46 KB, which is the **CI
  placeholder** leg's figure from that same table — cross-leg contamination in a
  section measured on real media. — an order of magnitude inside
  the ~40 KB the design budgeted. The 10 WebP twins, fetched only by an engine
  without AVIF, add 1.68 KB.

## Cache policy (task 2.6)

No `Cache-Control`, `immutable`, or Caddy cache directive was introduced: the
working-tree diff adds none, and `Caddyfile.example`, `docker-compose.caddy.yml`
and `Dockerfile` are untouched. Observed response headers, unchanged from the
Astro/node default and consistent across all four asset classes:

```
/center-focus.avif                        Cache-Control: public, max-age=0   ETag: W/"30683-…"   Last-Modified
/generated/center-focus-w1280.avif        Cache-Control: public, max-age=0   ETag: W/"1b0e4-…"
/_astro/index.C59do8XA.css                Cache-Control: public, max-age=0   ETag: W/"12347-…"
/_astro/fraunces-latin-standard-normal…   Cache-Control: public, max-age=0   ETag: W/"106e8-…"
```

A conditional GET on a generated variant returns **304 with a 0-byte body**, so
the tier probe's warm-cache locality inference still has its signal — and now has
more of it, since 84 generated assets join the revalidation set. The only
`Cache-Control` writes in `src/` are the pre-existing `no-store` on personalized
documents and API responses.

## Variant generation (task 4.10)

Both legs produce the **same 84 files** (`diff` of the two directory listings is
empty):

| leg                                                 | masters | files | largest generated                    | largest LQIP |
| --------------------------------------------------- | ------- | ----- | ------------------------------------ | ------------ |
| CI — placeholders extracted from `git show HEAD:`   | 30      | 84    | 25.2 KB                              | 0.46 KB      |
| local — real media after `restore-private-media.sh` | 30      | 84    | 179.6 KB (`center-focus-w1280.webp`) | 0.38 KB      |

Placeholder dimensions match the real masters exactly (README's claim, verified
for all 15 bases), which is why the no-upscale ladder is identical on both legs.
36 configured widths are correctly **not** emitted: 15 masters × 2 formats where
the width exceeds or equals the intrinsic size, including the three masters that
sit exactly on a ladder rung (`portrait-bottom-left` 768, `event-akad` 768,
`keluarga-yofri` 1280).

A second run against unchanged masters writes **0 files** and reports
`nothing to do` (mtime idempotency). Every one of the **122** same-origin URLs
the delivered document references returns **200** on the production server — no
guest-facing 404 from a `srcset` naming a file the generator skipped.

`prebuild` is honoured: `pnpm --filter web run build` runs the generator before
`astro build`, and `dist/client/generated/` receives all **85** files — the 84
derivatives plus `manifest.json`, which Astro copies with everything else under
`public/`.

## Still outstanding

DCL, total transferred against the 4501 ms / 2.66 MB baseline, and CLS across a
scrolled pageview are **not** recorded here — they belong to task 6.5 and need
the committed throttled harness (task 6.1) rather than an ad-hoc script. Total
transferred at rest on the 390 @2x leg was 3.96 MB in this run, which is not
comparable to the 2.66 MB baseline: it includes the Leaflet basemap tiles the
harness would have to exclude or account for, and it was measured unthrottled.

---

## Review pass (post-implementation corrections)

Measured after adversarial review, on the same production build and the same
overlay of real private media, at `127.0.0.1:4401`.

### Document weight — rationale comments were shipping 10× (task 5.4)

The markup rationale rewritten by task 5.4 sat inside `pictures.map()` as an HTML
comment, so Astro emitted it once per collage slot.

|                                                                                                              | bytes                | HTML comment bytes |
| ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------ |
| before                                                                                                       | 151 557              | 23 173             |
| after converting the 7 added comments to `{/* */}`                                                           | 137 972              | 9 588              |
| after also converting the pre-existing `<!-- Inner Image Container -->`, which sits inside the same `.map()` | **137 283**          | 8 878              |
| delta                                                                                                        | **−14 274 (−9.4 %)** | −14 295            |

The two deltas differ by exactly **21 B**, and the difference is not an error in
either column: between the two measurements the hero's `<link rel="preload">` also
gained `fetchpriority="high"` — 20 characters plus the separating space. Comments
account for −14 295, the attribute for +21, the document for −14 274. An earlier
version of this row printed −14 274 in both columns.

The table originally stopped at the second row and reported 137 972 / 9 588 as the
final figures, although the third conversion had already landed; every later
artifact quoted the stale pair. The eighth comment is not this change's — it is
HEAD's — but it costs ×10 like the one beside it, and converting it is in scope
for a change whose subject is document weight on a throttled link.

My rewritten version cost 1 164 B per copy against 768 B for the HEAD comment it
replaced — so the change had _added_ ≈4 KB of duplicated rationale to a document
whose entire subject is bytes on a throttled link. Astro strips `{/* */}`
expression comments from output; `<!-- -->` it does not. At 1.6 Mbps, 14.3 KB is
≈71 ms of transfer.

Every invariant was re-checked on the new document rather than assumed: 17
images, **0 without a `src`**, exactly one **`img[fetchpriority="high"]`** (plus
the matching one on the hero's preload `<link>`, which is required and is not an
image — counting occurrences of the attribute in the document yields 2 on correct
markup), 44 `srcset`s
with **0 duplicate `w` descriptors**, 4 basemap hints in `<head>` and **0 in the
body**, 5 `<noscript>` blocks, and the `@media (scripting:none)` rule for
`#loading-screen` still present in `dist/client/_astro/index.C59do8XA.css`.

### Basemap hints moved to `<head>` (task 2.1)

Task 2.1 first emitted them from `VenueMap.astro` at body level. A
`<link rel="preconnect">` in the body is an HTML conformance error — the Standard
permits a body `<link>` only with `itemprop` — and engines honour it there only
as a quirk. `index.astro:288` renders `<VenueMap />` unconditionally and is its
only consumer, so the original rationale ("Layout cannot observe whether
VenueMap mounted") did not hold. Verified after the move: **4 hints in `<head>`,
0 in the body**, and 0 `<link>` elements in the body at all.

### EventTimes reconstruction verified in the DOM (task 5.6)

An errant `git checkout` during guard testing reverted `EventTimes.astro` to HEAD
and destroyed the task-5.6 edit, which was never committed and so was
unrecoverable from git. It was rebuilt from the task text and the
`TimelineScroll` pattern, then verified against rendered markup rather than
assumed equivalent:

| image           | `srcset` candidates         | `sizes` | `width` |
| --------------- | --------------------------- | ------- | ------- |
| `event-akad`    | 2 — `-w390` + master `768w` | `100vw` | 768     |
| `event-resepsi` | 2 — `-w390` + master `584w` | `100vw` | 584     |

`event-resepsi` at 584 px yields only `-w390` plus the master, exactly as task
5.6 predicted and as the no-upscale rule requires — a single 390w would have
regressed the 584 px file the card ships today.

### Generator guards, negative-tested (task 4.8)

Each new guard was made to fail rather than merely read:

| injected fault                                                                     | result                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `variantSrcset("orphan-slot", …)` in markup + masters present, absent from `BASES` | build fails naming `orphan-slot`, exit 1         |
| `event-resepsi.webp` deleted (AVIF-only master)                                    | build fails: `has avif, needs avif+webp`, exit 1 |
| `square-top-right-lqip.avif.tmp-99999` orphan in `generated/`                      | pruned, reported                                 |
| 8.79 KB `center-focus-lqip.avif` written fresh (never re-encoded)                  | build fails over the 4 KB cap, exit 1            |
| clean tree                                                                         | 84 files, exit 0                                 |

The fourth is the one the encode-path check missed: an oversized placeholder
arriving from the Turbo cache or a hand edit never passes through the encoder, so
the cap is now re-checked over every reported LQIP regardless of path.

### Full-tier placeholder waste is real and measured (design D3)

D3 weighed inlining partly on "they would remove ten requests". At 390 @2x on an
unthrottled load (tier resolves to `full`): **23 `/generated/` requests on a
scrolled pageview — 10 discarded LQIPs, the 10 promoted collage candidates, and
the 3 lazy `TimelineScroll` images** (`awal-perkenalan-w390`,
`keluarga-acik-w768`, `keluarga-yofri-w768`). The no-script leg makes **13**: the
same 10 LQIPs and the same 3 timeline images, with nothing promoted. The legs
differ by exactly the 10 promotions, which is the comparison D3 needs; an earlier
version of this paragraph quoted "20 against 13", setting a collage-only subtotal
beside a total, and the pair did not close. Chromium's preload
scanner queues the live placeholder `srcset` before the inline promoter mutates
the DOM, so the ten requests are paid by the tier that could least afford to
waste them. 3.27 KB and multiplexed, so D3's conclusion holds; the saving it
assumed is simply not available.

### Outer-slot exposure at 1440 @2x (design OQ3, task 5.9)

| leg      | `keluarga-acik` candidate selected                                            | largest non-hero candidate selected                                       |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 390 @2x  | `-w768.avif` — 39.1 KiB on disk, **39.4 KB transferred** (master is 462.9 KB) | none over 200 KB                                                          |
| 1440 @2x | `-w1280.avif` — 93.1 KiB on disk                                              | `square-top-right.avif` (master) — 317.6 KiB on disk, ~318 KB transferred |

Which candidate the engine selected is the measured fact; the KB figures beside
each are `statSync().size`, per the Units section above, except where a transfer
figure is labelled as one. An earlier version of this table headed both columns
"fetched" while carrying on-disk sizes in one and a transfer-rounded size in the
other.

At rest on both legs: **0 of 5 `loading="lazy"` images loaded**; after a full
scrolled pageview all resolve and **0 of 24 (390) / 0 of 36 (1440)** images are
undecoded, with all 10 collage slots promoted.

The 1440 @2x row is the exposure follow-up 4 files. An earlier version of this
paragraph sized it as "nine outer slots × ≈318 KB ≈ **2.9 MB**", which was wrong
by ~4× and self-contradicting: the table above says nothing else on that leg
exceeds 200 KB, so nine copies of a 318 KB file cannot have been fetched. Only
`square-top-right.avif` is anywhere near that size.

Measured from `public/`, the nine outer masters total **727.8 KB** (0.71 MiB), and
only **7 of the 9** have a `-w768` rung to fall back to at all — `square-mid-left`
(473 px) and `portrait-bottom-left` (768 px) have no generated candidate above
390w, so they select their master under either cap and changing the cap does
nothing for them. The 383px option therefore saves 669.2 − 286.8 = **382.4 KB**
across the 7 affected slots, not 1.25 MB across nine.

Selection still happens because 780 device px misses the 768w rung by 12 px, and
it is still **tier-independent** — a `lite` guest who scrolls pays it too — which
task 5.9's note originally got wrong. At 382.4 KB, DPR-2-only, on slots the design
already declares underserved on purpose, follow-up §4 is a **low**-priority item;
at the 2.9 MB originally filed it read as urgent, which is why the arithmetic is
corrected here rather than only in the follow-up.
