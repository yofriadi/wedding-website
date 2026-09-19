# Design: families-text-reveal

## Context

`apps/web/src/components/` is Astro-only: the app has **no `@astrojs/react` and no `react`** in `apps/web/package.json`, and `astro.config.mjs` registers no framework integration. The requested install command therefore cannot run. Magic UI components enter this repo as hand-ports (`TextShimmer.astro`, `DotPattern.astro`), and its scroll behaviour enters as either pure CSS scroll-driven animation (`HeroZoom`'s `--sweep` band) or the **vanilla** `motion` API — `import { animate, scroll } from "motion"` in `TimelineScroll`, `ZoomParallax`, `WeddingFAQ`, `SlideToConfirm`.

The reference implementation, read from the live registry (`magicui.design/r/text-reveal.json`, `registry/magicui/text-reveal.tsx`):

```
<div class="relative z-0 h-[200vh]">            ← runway
  <div class="sticky top-0 h-[50%] max-w-4xl    ← stage = 50% of 200vh = 100vh
       items-center px-4 py-20">
    <span class="flex flex-wrap text-2xl md:text-3xl
         lg:text-4xl xl:text-5xl
         text-black/20 dark:text-white/20">     ← ghost base colour
      {words.map((w,i) =>
        <span class="relative mx-1">
          <span class="absolute opacity-30">{w}</span>       ← ghost (20% × 30% ≈ 6%)
          <motion.span style={{opacity}}>{w}</motion.span>   ← ink, scrubbed 0→1
        </span>
        start = i/n ; end = start + 1/n
      )}
    </span>
  </div>
</div>
```

`useScroll({ target })` was given no `offset`. Verified in this repo's installed copy (`motion-dom` `render/dom/scroll/offsets/index.mjs`: `offset ?? ScrollOffset.All`, `presets.mjs`: `All = [[0,0],[1,1]]`) that the default is **"start start" → "end end"**: progress 0 when the section's top meets the viewport top, 1 when its bottom meets the viewport bottom. For a 200vh runway that is exactly the 100vh of pinned travel — so **the last word lands the instant the stage unpins**. That alignment, not the 200vh itself, is the thing worth preserving.

Content constraints: two blocks, four rows each, one authored hard line break, one divider, 28 words total, copy fixed by the couple.

Owner decisions recorded before this document: no React; **Magic UI wins wherever it conflicts with the original brief** (so the 200vh pinned runway and the per-word grain stand, and the "make sure it all shown on viewport" wording is relaxed); ghost alpha at the ported recommendation; copy verbatim with no role labels; `QuranVerse` is retired and this section takes its slot after the hero.

## Goals / Non-Goals

**Goals:**

- Reproduce Magic UI's two-tier word reveal — same mechanism, same stage geometry, same chain semantics — in an Astro component with zero new dependencies.
- Carry structured, multi-block content through a mechanism designed for one flat string, without losing the single continuous reveal boundary.
- One black ↔ white ink pair that follows the device scheme through the repo's CSS-variable idiom.
- Guarantee the fully-revealed content fits its own stage at every supported viewport — Magic UI's fixed type ramp does not, at 12–15 stacked rows.
- Retire `QuranVerse` cleanly, including the spec requirements that name it.

**Non-Goals:**

- Running the shadcn/magicui CLI, or adding a React integration to enable it.
- Re-timing or shortening the runway to reduce the page's scroll tax (explicitly waived in favour of Magic UI).
- Interleaved/symmetric reveal ordering across the two columns (see D5 — chosen, with a cheap reversal path).
- Any change to `HeroZoom`, `ZoomParallax`, or `TimelineScroll`.
- Adding role labels ("Mempelai Pria/Wanita"), a third family block, or photo treatments around this section.
- Restoring or replacing the Quran verse content in another form.

## Decisions

### D0 — Owner-review rework: travelling reveal, single tier, real Geist

The first implementation pinned a 200lvh runway with a sticky stage and a
two-tier ghost/ink word (an opacity sweep over a constant ghost). On review
of the docs demo the couple called out two things:

1. **The copy must travel.** The reference they had in mind is the demo's
   scrolling variant: the text block moves with the document while the
   colour sweep crosses it — "make it move as user scroll while animate the
   font color … roughly 40/45% from bottom viewport". The pin is gone. Each
   revealable unit (word or divider) now maps its opacity to its OWN
   document position against a single normalised driver:

   ```
   y  = (scrollY + 0.9·lvh) / (0.325·lvh)     // written once per frame
   dᵢ = docCentreᵢ      / (0.325·lvh)          // measured at init / width change
   opacityᵢ = clamp(ghost, y − dᵢ, 1)
   ```

   A word starts inking when its centre crosses 90% of the viewport height
   and is full ink by 57.5% (≈42.5% up from the bottom — the band the couple
   pointed at); above that it keeps travelling, inked. `lvh` is the
   normalising unit, so browser-chrome collapse cannot rescale the ramp
   (scroll-motion's lvh rule for downward-watched scrubs). The per-frame JS
   cost is still one custom-property write; the per-word `--d` values are
   written by init code, never in the scroll path.

2. **The font was not the demo's font.** The site's `--font-sans` token
   named `Inter`, which was never loaded anywhere, so every sans word on the
   site silently fell back to the system stack. The docs demo renders in
   **Geist** (variable 100–900), confirmed from the live page. Geist is now
   loaded via `@fontsource-variable/geist` and the token points at it.

Consequences: D3's chain/`--n`/`--s` numbering is replaced by the position
mapping above; D5's block-major ordering question is moot on desktop (rows
at the same height ink together) and reads top-to-bottom on mobile; D7's
aria-hidden ghost tier is gone entirely (single-tier words — the DOM
announces each word once by construction); D9's divider keeps its own slice
but reveals by the same position rule instead of a chain window; D8's type
sizing survives verbatim; D10's reduced-motion collapse simplifies to "no
scrub is bound" because there is no runway to collapse. The pinned-design
decisions below remain for the record.

### D1 — Hand-port with vanilla `motion`; no React, no CLI

`FamiliesReveal.astro` is authored directly. Alternatives rejected: adding `@astrojs/react` + `react` to serve one presentational component (a new render pipeline, hydration surface, and dependency set for a section that must never hydrate — it is entirely scroll-driven); and CSS `view-timeline` + a JS fallback (see D3).

### D2 — Block data in, flat string out

Magic UI's `children: string` prop with `split(" ")` cannot express this content: it has no concept of a line, a row, a heading, a divider, or a hard break. The component takes structured props instead:

```
blocks = [{ heading, names: [..], address: [line, line?] }, …]
```

Each line is split on whitespace into word units; the units are numbered in **document order across all blocks** to form one chain of `n = 28` slices, `start = i/28`, `end = (i+1)/28` — Magic UI's exact mapping. An authored line break becomes a row boundary in the markup, never a collapsed space. This keeps the component a genuine port of the _mechanism_ rather than of the _prop shape_, and makes the divider a first-class participant in the chain (D9).

### D3 — One scrubbed custom property; per-word opacity computed in CSS

```css
/* registered so the value is a real <number>; see D4 for the fallback */
@property --families-p {
  syntax: "<number>";
  inherits: true;
  initial-value: 1;
}

.fw-ink {
  opacity: clamp(0, calc((var(--families-p) - var(--s)) * var(--n)), 1);
}
```

with `--s` (this word's chain start) emitted per word by the Astro frontmatter and `--n` emitted once on the stage. Each word's window is exactly `1/n` wide, so the normalising division collapses to a multiplication by `n` — no division inside `calc()`, which sidesteps the historically inconsistent right-hand-side-of-`/` rules.

JS is then one write per frame, independent of word count:

```ts
import { scroll } from "motion";
const stop = scroll((p) => stage.style.setProperty("--families-p", `${p}`), {
  target: section,
  offset: ["start start", "end end"],
});
```

Alternatives considered:

- **`animate()` + `scroll(anim)`**, the `TimelineScroll` idiom, scrubbing the registered property. Rejected: it depends on `motion` interpolating a registered custom property, and its 4-argument keyframe form buys nothing over the callback.
- **`useTransform`-equivalent per word** (28 MotionValues, 28 style writes/frame). Rejected outright — it violates the house performance discipline for scroll pieces ("no per-frame layout work", one rect read max) and HeroZoom's `--sweep` comment establishes the single-property pattern in this repo already.
- **Pure CSS `animation-timeline` + a JS fallback**, exactly HeroZoom's shape. Rejected: two code paths to keep in phase. HeroZoom's fallback is ~120 lines of hand-maintained keyframe mirroring; a second component of that shape is not worth it when `motion` is already a hard dependency of this page.

Note on the chosen form: `motion`'s `scroll()` routes a callback + `target` through `scrollInfo` (`isElementTracking` is true whenever `target`/`offset` is set), i.e. the JS rAF path rather than a native `ViewTimeline`. Accepted: it is the path `TimelineScroll` already runs, and it keeps the offset semantics identical to Magic UI's `useScroll`.

### D4 — Authored state is reveal-complete

`--families-p` initial value is `1` and the stage declares `--families-p: 1`, so **server-rendered, pre-JS, JS-failed, and reduced-motion renders all show fully opaque text** and the reveal is strictly an enhancement. This is HeroZoom's rule — "the static fallback is the readable, fully revealed hero" — and it removes any `@property`-support dependency from the reveal's correctness: where `@property` is unsupported, the JS simply writes a token that still substitutes into `calc()` and still evaluates.

Consequence: a deep-link or scroll-restoration landing inside the section flashes revealed-then-ghosted. Mitigated by `scroll()` invoking its handler on bind, so the correction is same-frame and pre-paint; accepted if a real device shows otherwise.

### D5 — Chain order is document order, which means left column finishes first

"Follow Magic UI" is taken to include its single in-order chain, so the 28 slices run all of block one, then all of block two. On a phone (blocks stacked) that reads top-to-bottom. On a desktop two-column layout it means the **left family completes before the right family begins** — an announcement, not a symmetric wave.

This is the one decision most likely to be reversed on taste. It costs a per-word index remap in the frontmatter (row-major instead of block-major ordering) and nothing else; recorded in Open Questions.

### D6 — Ghost alpha raised, and expressed as a token

Magic UI's effective ghost is `text-black/20` × `opacity-30` ≈ **6%** ink. On this page's `#0a0a0a` baseline, 6% white is within a few codes of the background: the pre-reveal state stops reading as "text is coming" and the effect degrades to a plain fade. The ghost is raised to **20% dark / 15% light**, held as its own variable rather than baked into the tier:

```
--families-ink   : #ffffff (dark)  / #000000 (light)
--families-bg    : #0a0a0a (dark)  / #ffffff (light)
--families-ghost : color-mix(in oklab, var(--families-ink) 20%, transparent)
                   … 15% under prefers-color-scheme: light
```

Dark is the authored baseline and light inverts it — the `--verse-*` / `--rsvp-*` / `--memories-*` / `--gate-*` idiom used by nine components here. Note `<html class="dark">` in `Layout.astro` is decorative: `global.css` defines no `@custom-variant dark`, so Tailwind's `dark:` is media-query-driven regardless. **Magic UI's `text-black/20 dark:text-white/20` utilities are therefore not the port's mechanism** — variables are.

The section paints its own background (like `#verse-container` and `#rsvp-section` before it) because `body` is `bg-neutral-950 text-white` in both schemes. The owner expects photos directly above and below this section, so the seam colour is not load-bearing; still, `--families-bg` follows the neighbouring sections' `#0a0a0a`/`#ffffff` pair rather than literal `#000` on dark, while the **ink stays literal black/white as specified**.

### D7 — The ghost tier is `aria-hidden`

Magic UI duplicates every word into the DOM (ghost span + ink span) and screen readers therefore announce the sentence twice. That is a bug in the original, not a feature of the effect, and it is not ported: the ghost span carries `aria-hidden="true"`, and the ink span is the accessible content. Generated-content ghosts (`::before { content: attr(data-w) }`) were rejected because announcement of `content` strings is inconsistent across AT, whereas `aria-hidden` is not.

### D8 — Type sized from viewport height, not a fixed ramp

Magic UI's `text-2xl md:text-3xl lg:text-4xl xl:text-5xl` plus `py-20` assumes one short sentence. This content is 6 rows per block: 12 text rows plus two divider groups plus the inter-block gap when stacked, so 14–15 line boxes. Inside a `100lvh` stage with `py-20` (160px) removed, a 568px-tall phone has ~408px left; 15 rows at `text-2xl`/1.5 leading needs ~540px. **It overflows by roughly a third.**

Sizing is therefore derived from the axis that is actually scarce:

```
stage padding:  ~8lvh total, not py-20
body font-size:  min(2.6rem, 3.6lvh) with a floor of ~0.9rem
```

`3.6lvh × 1.5 leading × 12 rows ≈ 65lvh`, + ~7lvh of dividers + ~6lvh gap ≈ **78lvh inside an 84lvh content box**. The `min()` ceiling also reproduces Magic UI's ramp for free, because that ramp is roughly viewport-proportional anyway: 3.6lvh ≈ 24px on a 667px phone (Magic UI's `text-2xl`), ≈ 32px at 1440×900 (`text-3xl`), ≈ 39px at 1920×1080 (`text-4xl`). Values are starting points; the spec's fit scenarios at 320×568 and 375×667 are the authority, and the Playwright assertion in tasks is how they are held.

Two structural rules come with it: the section **must not set `overflow: hidden`** (an `overflow`-clipping ancestor turns `position: sticky` into a no-op — the whole design depends on the stage pinning), and `contain: paint` is applied to the stage only, which does clip the stage's own descendants without touching the ancestor chain.

### D9 — The divider joins the chain with the same two-tier treatment

Magic UI has no rule element. Rather than have a hairline appear out of nowhere between the names and the address, the divider is given its own chain slice at its block's boundary and reveals horizontally — `transform: scaleX(clamp(0, calc((var(--families-p) - var(--s)) * var(--n)), 1))` with `transform-origin: center` — over a ghost rule at `--families-ghost`. Same property, same single write, no extra JS, and the divider reads as part of the same sweep instead of a separate animation.

### D10 — No pin at all under reduced motion

Per the sibling components' pattern, `prefers-reduced-motion: reduce` collapses the runway: `height: auto` on the section, `position: static !important` on the stage, `--families-p: 1`, and the script returns before binding anything (mirroring `ZoomParallax`'s early `return` and TimelineScroll's no-bind branch). The two-column/stacked layout and the theming are untouched, so the section degrades to a plain, readable, correctly-coloured credit list.

### D11 — Retiring `QuranVerse`

`<QuranVerse />` is removed from `index.astro`'s composition and `QuranVerse.astro` is deleted. Checked, not assumed:

- **No test references it** (`apps/web/tests/` grep: none).
- **`--ease-blur-reveal` survives**: `EventTimes.astro:195-197` is a live consumer, so deleting the verse does not orphan the token and does not violate motion-tokens' "a token with zero consumers SHALL NOT be kept". The `global.css:17` comment attributing the curve to QuranVerse is reworded to `EventTimes`, and `EventTimes.astro:25`'s cross-reference is updated with it.
- **Spec ownership**: only `openspec/specs/scroll-motion/spec.md` states requirements about it (two), plus a passing mention in that spec's Purpose line, which is updated by this change's delta at archive time.
- The `#verse-*` variables live in the component's own `<style>` and go with it; nothing in `index.astro`'s `:root` belongs to the verse.

### D12 — Init follows the repo's non-SPA trap

This site has no `<ClientRouter />`, so `astro:page-load` never fires; every component here initializes through the `document.readyState` / `DOMContentLoaded` branch, as `VenueMap`'s comment records and the `scroll-motion` spec notes. Cleanup functions are held in an array (`ZoomParallax`/`TimelineScroll` precedent) and a width-only guard ignores the height-only `resize` that browser chrome emits, so scrub bindings are never rebuilt mid-scroll.

## Risks / Trade-offs

- **200lvh of pinned runway for a name list, placed where attention is freshest** → Accepted by the owner over a cheaper design. If it reads as too long in review, the entire adjustment is one number: section height and the chain's `--n`-independent ranges stay valid because `scroll()`'s offset is proportional, so shrinking the runway to 150lvh needs no other edit.
- **28 opacity changes per frame inside a sticky stage may repaint the stage on Safari** → `contain: paint` on the stage; no `will-change` on the ink tier (opacity-only animation is already compositor-friendly, and the retired QuranVerse requirement shows hint-release discipline is a footgun this repo has been caught by once). If a device pass shows jank, the fallback is `@property`-registered `--families-p` animated through `animate()` so `motion` can take the native `ViewTimeline` path.
- **The fit ceiling can force uncomfortably small type on short phones** — 3.6lvh at 568px tall is ~20px for what is meant to be a display moment → Trade-off is real and intentional: legible-and-small beats clipped-and-large. The 320×568 Playwright scenario is the tripwire; if the measured size falls below ~0.85rem the design should be revisited (shorter runway, or one block per stage) rather than silently allowed to shrink.
- **Deleting the verse removes the invitation's only religious opening**, which some guests will expect → The couple's explicit call; the file is one `git revert` away, and the spec delta records it as REMOVED with reasons rather than letting the requirement silently rot.
- **Block-major chain order may read as lopsided on desktop** (D5) → cheap, isolated reversal; flagged as an open question instead of pre-emptively "fixed".
- **Left `overflow: hidden` or `transform` on an ancestor of the stage and sticky dies without an error** → the fit scenarios at 320/375 catch a non-pinning stage because the content's position stops tracking progress; called out in tasks as an explicit don't.
- **Deep-link/scroll-restoration flash** (D4) → bounded to one frame by `scroll()`'s bind-time call; accepted.
- **Ghost alpha is a taste call made from a screenshot, not from a device** → 20%/15% is a starting point recorded in a token; the verification pass looks at it on a real OLED where 6%-vs-20% is most visible.

## Migration Plan

1. Land `FamiliesReveal.astro` and the `index.astro` insertion together; the section is self-contained and inert until composed.
2. Remove `<QuranVerse />` and delete the component in the same change, along with the `scroll-motion` delta (REMOVED ×2, MODIFIED ×1, ADDED ×3).
3. No DB, no API, no dependency, no build-config change — `motion` is already an optimized dep in `astro.config.mjs`, so no `optimizeDeps` edit is needed.
4. **Rollback**: revert the commit. Nothing is additive to persisted state and no other section reads anything this one writes.

## Open Questions

- **D5 ordering** — is the desktop left-column-then-right sweep what the couple wants, or should the two families reveal together row by row? One frontmatter remap either way; needs eyes on a device.
- **How far "follow Magic UI" overrides "all shown on viewport"** — this design assumes the runway and reveal grain are the waived parts and that _not clipping_ survives as a hard requirement. If the intent was instead "magicui's ramp even if a short phone scrolls", the fit scenarios come out and D8 simplifies.
- **Divider vs underline** — the brief said "underline or divider"; this design ships a hairline rule between names and address (D9). If it should actually sit _under_ the parents' names as an underline, that is a presentational change to D9 only.
- **Heading copy repetition** — both blocks read `Keluarga` with nothing distinguishing them. Shipped verbatim as instructed; worth one more look before it goes to print/family review.
- **Whether the section needs its own background at all**, given photos are planned immediately above and below it. Shipped painted, since it is currently bordered by `main`'s `bg-neutral-950` on one side.
