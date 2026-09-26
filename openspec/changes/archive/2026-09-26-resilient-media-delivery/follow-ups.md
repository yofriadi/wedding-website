# Follow-ups filed by resilient-media-delivery

Seven things this change deliberately did **not** do, recorded here so they are
picked up rather than rediscovered. Each is out of scope for a stated reason, not
because it is unimportant. None blocks archiving this change.

---

## 1. `public/` revalidates on every repeat visit (task 7.3)

**The largest remaining performance win, and it needs its own change.**

Everything under `apps/web/public/` is served `Cache-Control: public, max-age=0`
with an `ETag` — the Astro/node default, which `Caddyfile.example` does not
override. A returning guest therefore issues a conditional GET for every asset
the page references and receives a 304 for each. `Layout.astro`'s own
LOAD-BEARING comment uses the figure **~23 assets**; this change grows that set
by up to **84 generated variants** (only the subset the page actually references
revalidates, but the direction is up), plus the fonts and bundled chunks.

At 150 ms RTT that is real latency on a warm cache, even though HTTP/2
multiplexes it. The obvious fix — `immutable` with content-hashed filenames —
**cannot be applied to `public/` as it stands**, because the tier probe reads the
304s as evidence:

> `Layout.astro`, `readBurst()`: an asset whose body arrived without a payload
> transfer is _locality_ evidence, not throughput evidence. A 304 revalidation
> reports `transferSize` ≈ 300 with `encodedBodySize` 0, and that shape is what
> makes `localHits` climb to `MIN_LOCAL_HITS = 5` and resolves a `pending` tier
> to `full` at `load`.

Under `immutable`, a warm-cache hit reports `transferSize` 0 **and**
`encodedBodySize` 0, which is indistinguishable from a _blocked_ resource-timing
entry. The `if (!body) { if (size > 0 || e.decodedBodySize > 0) localHits++; }`
branch would stop counting, the locality inference would stop firing, and **every
returning guest on an engine without the Network Information API — Safari and
Firefox, i.e. the whole iOS population on the second and every later open of a
link people reopen constantly — would fall through to the failsafe's `lite`**,
with no test failing.

**What a follow-up must do:** redesign the probe's locality signal so it does not
depend on the 304 shape (a `fetch(..., { method: "HEAD" })`-free option is to key
on `decodedBodySize > 0` alone, or to mark hashed assets and treat any zero-cost
hit on a marked URL as local), _then_ move `public/` — or only the generated and
bundled subsets — to long-lived caching. Note the asymmetry worth exploiting:
`public/generated/**` filenames are **not** content-hashed (`<base>-w768.avif`),
so `immutable` there also needs a naming change or a cache-busting query.

**Do not** touch `Caddyfile.example` or add a `Cache-Control` header before the
probe is redesigned. Task 2.6 of this change exists to confirm nobody did.

---

## 2. `venue-map.ts` `bannerHtml()` popup image (task 7.4)

`apps/web/src/components/venue-map.ts:123` builds a photographic `<img>` as an
HTML string that Leaflet injects into a marker popup:

```js
return `<div class="venue-map-popup-banner"><picture><source src="${avifSrc}" type="image/avif"><img src="${src}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" onerror="this.parentElement?.remove()"></picture></div>`;
```

Against `responsive-media` this image is missing:

- **`width`/`height`** — and the popup banner is the one case in this change where
  intrinsic dimensions genuinely _reserve layout_, because the popup sizes itself
  to its content. Without them the popup reflows when the bytes land.
- **`srcset`** — a single candidate at full master resolution.
- its `<source>` is **single-candidate**, so AVIF-capable engines get no choice
  of resolution either.

The three masters are all present and all photographic:
`public/map/{graha-58,selat-solo,smk-murni}.{avif,webp}`.

**Why it was scoped out rather than exempted:** `responsive-media`'s requirements
are written against **server-rendered markup**, and this element is created at
runtime by a third-party widget — the requirement names it explicitly as outside
scope and names this follow-up. It is tracked, not waived.

**What a follow-up must revisit:** this is the only raster **subdirectory** under
`public/`. Task 4.1's generator refuses to walk subdirectories (and errors on a
base name containing `/`) precisely because nothing consumed `public/map/` —
scanning it would have emitted **16** files of dead output, which design D3 names as
the rejection criterion. If this lands, `public/map/` becomes a real input: the
generator needs relative-path support (output to `public/generated/map/` or
beside the masters), the no-subdirectory guard in `guardInputSet()` must be
relaxed, and the three base names must join `BASES`. The markup side is already
served by `variantSrcset()` if the generator emits to `/generated/`, but the
current `^[a-z0-9_-]+$` test in `guardInputSet()` forbids exactly that base name —
so either the guard or the naming convention changes. (An earlier draft of this
paragraph cited a `base.includes("/")` call, which the character-class test
subsumed and replaced.)

---

## 3. Is the 220 KB/s tier floor still correctly tuned? (task 7.5)

**Record and file; do not retune.** Tier _detection_ is an explicit non-goal of
this change (`design.md` Goals/Non-Goals), so the constant stands untouched.

`Layout.astro` sets `MIN_FAST_BYTES_PER_MS = 220` — 220 KB/s expressed in bytes
per millisecond, decimal, matching the spec's figure. Below it a measured burst
resolves to `lite`. That threshold was tuned against a lite tier that **showed ten
empty frames** and transferred **zero** collage bytes.

This change alters both sides of that trade:

- a lite tier now **renders something** — ten blurred placeholders, and the
  collage reads as photographs rather than as holes;
- a lite tier now **costs bytes it previously did not**: 3.27 KB measured for the
  ten AVIF placeholders (the design budgeted ~40 KB against a 4 KB-per-file cap;
  the actual figures came in an order of magnitude lower).

So the penalty for a false `lite` verdict is smaller than it was, and the cost of
a correct one is slightly higher. Both shifts argue for **re-measuring** the
threshold rather than assuming it, and they argue in opposite directions — which
is exactly why this is a measurement task and not a guess.

**What a follow-up should do:** re-run the threshold sweep against real
connection profiles (the committed throttled harness from task 6.1 is the right
instrument), with the _user-visible_ outcome as the metric rather than bytes —
specifically, at what measured throughput does a lite tier's placeholders-plus-
upgrade-on-approach read worse than a full tier's slower-but-complete load. Also
worth checking in the same pass: `PROBE_FLOOR_BYTES` (48 KB) and
`LOAD_FALLBACK_BYTES` (8 KB), since the burst this change produces is a different
shape — the hero is now preloaded from the head, the fonts are down from 293 KB
to 179 KB, and the collage contributes 3 KB instead of nothing.

Open Question 5 in `design.md` records the same question from the planning side.

---

## 4. The outer collage `sizes` cap is inert at DPR ≥ 2, and a lite guest pays ≈728 KB for it

**Filed from:** design OQ3, task 5.9, and the 1440 @2x measurement leg.

`ZoomParallax.astro`'s `SIZES_OUTER = "min(33vw, 390px)"` changes candidate
selection only at **DPR 1 above ~1182 CSS px**. On every phone `33vw < 390px`, so
the cap never binds. On every retina desktop the capped and uncapped values
select the same candidate.

Measured at 1440 @2x: the cap lowers demand from 950 to 780 device px and **still
misses the 768w rung by 12 px**, so all nine outer slots select their 1024 px
masters. Measured, the nine total **727.8 KB** — only `square-top-right.avif`
(317.6 KB) is large, and an earlier draft of this file claimed ≈2.9 MB by
multiplying that one file by nine. Note also that only **7 of the 9** can be
affected by the cap at all: `square-mid-left` (473 px) and `portrait-bottom-left`
(768 px) have no generated candidate above 390w, so they select their master
under either value.

**Why this is not gated on a fast connection.** Candidate selection is a function
of `sizes` and DPR alone. The tier decides only _whether_ promotion happens,
never _which_ candidate the promoted `srcset` resolves to. A `lite` guest at
1440 @2x who scrolls within the promotion margin pays the same nine masters, on
the slow link the tier exists to protect. `media-tiering`'s "Lite tier pays per
approach" scenario permits it, because that scenario governs _no_ candidate
transferring before approach rather than the size of what transfers on approach.
Task 5.9's note originally called this "a fast-connection `full`-tier path"; that
was wrong and is corrected there.

**Why it was not fixed here.** Lowering the cap to `min(33vw, 383px)` lands the
rung: 766 device px selects the `-w768` candidate instead of the master, saving
669.2 − 286.8 = **382.4 KB** across the 7 slots that have one (not the ≈1.25 MB
an earlier draft claimed), for a 1.8 % further underserve of a slot that is
475 CSS px wide at that viewport and is already underserved by design. OQ3
reserves both `sizes` numbers as "starting values to confirm **visually** during
task 5.1", and a byte measurement is not a visual confirmation. Substituting a
byte criterion for the owner's stated one is what the phase-0 reservation exists
to prevent, so the decision is handed back rather than taken.

**What a follow-up should do:** confirm the two `sizes` values visually at
1440 @2x and 390 @2x as OQ3 asks, then decide 390 vs 383 with both inputs. Note
the limitation before choosing: **383 helps only at DPR 2.** At DPR 3 the same
nine slots select the master under either value, because no fixed CSS-px cap can
land a rung at every device pixel ratio. If the exposure matters at DPR 3 too,
the lever is the ladder (a rung between 768 and 1024) or the masters themselves,
not the cap — and both are outside this change's scope, the ladder fixed by
task 4.1 and the masters being private media.

---

## 5. Turbo Remote Cache would archive derivatives of private photos, with no guard

**Filed from:** task 4.6 and constraint 1.

Constraint 1 is called non-negotiable: _any generated variant of a real photo is
itself private media and must never be committed._ `.gitignore:93-99` enforces
that against git. Task 4.6 then adds `public/generated/**` to `turbo.json`'s
`build.outputs`, which archives the same derivatives into the **Turbo cache** — a
store `.gitignore` does not reach.

Verified **currently inert**: no `TURBO_API`, `TURBO_TOKEN` or `TURBO_TEAM` in
`turbo.json`, `.github/workflows/docker-image.yml`, or any `.env*`. No remote
cache is configured, so the archive is local-only today.

But enabling Turbo Remote Cache is a one-line, routinely-recommended change, and
the moment anyone does it, up to 84 derivatives of the couple's private photos
upload to a third-party cache. Every other privacy boundary in this repo has an
explicit guard — `skip-worktree`, `.gitignore`, `restore-private-media.sh`'s own
warnings. This one has none, no test, and nothing in the artifacts warning the
next person.

**What a follow-up should do:** add a CI assertion that no `TURBO_*` remote-cache
variable is set while `public/generated/**` remains a build output, or gate the
output entry on their absence. A warning beside the `public/generated/**` mention
in `README.md` is the minimum. Do not simply drop the output entry — task 4.6's
negative control shows that without it a `FULL TURBO` cache hit restores
`dist/client/generated` but leaves the working tree at **0 files**, which breaks
`astro dev` and the generator's mtime comparison.

---

## 6. `MagneticImageTrail` downloads guest photos at 2048 px with no candidate set

**Filed from:** review; larger than follow-up 2 and filed for consistency.

`MagneticImageTrail.astro:296-299` loads guest photos via `new Image()` at full
normalized resolution — `image-encode.ts:8` caps uploads at
`MAX_PHOTO_EDGE = 2048` — and draws them into a canvas. A 390 px phone therefore
downloads a trail of 2048 px guest photos with no `srcset`, no `sizes` and no
generated candidates: **the precise defect this change exists to fix for
`keluarga-acik`, on the page's most numerous photographic assets**, and the count
grows with every photo guests upload.

`proposal.md:38` acknowledges it in one clause ("neither has an `<img>`") and
files nothing, while filing follow-up 2 for the strictly smaller single map
popup. That is an inconsistency in the filing, not a spec violation: the element
is a canvas, so it is formally outside `responsive-media`'s requirement for
server-rendered markup, and it is properly labelled (`role="img"` plus
`aria-label` at `:31-33`).

**What a follow-up should do:** decide whether guest photos join the generation
pipeline at all. They cannot be pre-generated — they are uploaded at runtime, so
there is no build step to hook. The realistic options are a runtime resize on
upload (extending `image-encode.ts` to emit a small trail variant beside the
full one) or `createImageBitmap` with a resize at draw time. Both are a different
change with a different privacy surface, since a derivative of a guest upload is
guest data.

---

## 7. Nothing enforces that markup's declared `width` equals the master's intrinsic width

**Filed from:** review; the invariant holds today and nothing keeps it holding.

`media-candidates.ts:44-46` calls it a MUST and `ZoomParallax.astro` repeats it:
the `width`/`height` in markup must state the master's true intrinsic size,
because `variantSrcset()` derives the ladder from that number and the generator
skips every configured width at or above the real one. A mismatch names a file
that was never emitted — a guest-facing 404 that no build step currently catches.

Verified by probing all 15 bases with `sharp`: every declared pair matches
exactly (`ZoomParallax` `iw`/`ih` ×10, `TimelineScroll` 591×1280 / 1280×591 /
2048×945, `EventTimes` 768×433 / 584×525), and every `.avif`/`.webp` pair agrees.
The generator now fails when the two _formats_ of one base disagree, which is the
half it can see; it cannot see the number a component hardcodes.

**What a follow-up should do:** the generator already reads every intrinsic width,
so have it emit `public/generated/widths.json` and assert markup against it in a
test — or better, stop hardcoding. Reading dimensions at build time the way
`WelcomeGate.resolveGateBg()` does removes the duplication entirely, at the cost
of a `sharp` header read per image per render; whether that belongs in frontmatter
or in a generated module is the design question. Note that three of the ten
`ZoomParallax` slot comments misdescribe their own aspect ratio (`square-mid-left`
is 473×1024 portrait, `center-focus` is 1920×1280 landscape, `square-mid-right`
is 1024×768 landscape) — corrected in place, but the base names are filenames and
cannot change, so a generated width is the only trustworthy source.

---

## 8. One home per mechanism claim; the generator's comment body is frozen

**Filed from:** five review passes, on the reviewer's recommendation rather than
as a defect.

`generate-media-variants.mjs` grew from 346 to ~780 lines across five review
passes, roughly 330 of them comment. Three of pass 5's five findings were the
same failure mode: a mechanism claim corrected in one copy while a sibling kept
the old one — `MARKUP_SOURCES` fixed at `:110` and contradicted at `:448`; the
`~18 files` figure repeated in four artifacts; `README.md` asserting a Turbo
dotfile-glob behaviour the generator had already demoted to untested.

**This is a live risk, not a historical one.** But the blast radius is prose only,
every instance found was a one-word or one-clause fix, and the mechanisms that
matter operationally are now anchored to something self-checking rather than to a
sentence: the generator prints the **name** beside the largest variant's size, the
manifest _is_ the fingerprint, and `measurements.md`'s "Units, stated up front"
section is the single home for the transfer/on-disk distinction.

**What a follow-up should do:** give each drifting claim exactly one home and
reference it from the others — Turbo's input/output semantics, the 84/85 file
count, and the byte figures are the three that have each drifted twice. Do it the
next time the comment body is open anyway (follow-up §2 or §7, both of which
change `BASES`), not as a standalone pass: a freeze-and-deduplicate restructure
now would touch every comment in the file for zero behavioural gain and invalidate
the line citations in four artifacts.
