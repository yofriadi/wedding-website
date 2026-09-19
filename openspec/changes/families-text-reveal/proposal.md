# Proposal: families-text-reveal

## Why

The invitation opens with the couple's names and date but never says _whose families_ are inviting — the hosts (both sets of parents) and their addresses appear nowhere before the venue block. Indonesian wedding invitations conventionally present `Keluarga Besar` for each side early, and the couple wants that beat as a deliberate, animated moment rather than a footnote in the details section.

The couple also supplied the exact design reference — Magic UI's [`text-reveal`](https://magicui.design/docs/components/text-reveal) — and asked for it verbatim. On review of the docs demo they clarified the target: the variant where the copy **travels through the viewport** with the document and each word inks as it crosses the centre band — not a pinned runway where the stage sits still. Where Magic UI's behaviour and the original brief's wording conflicted, **Magic UI wins**; where the first implementation (pinned) conflicted with the couple's reading of the demo, the demo wins.

## What Changes

- **New `FamiliesReveal` section** on the homepage, placed immediately after `HeroZoom`: two family blocks (parents' names, a hairline divider, the family address) that travel up through the viewport as ordinary flow content, each word inked as its centre crosses the viewport's centre band (ghost below, ink by ~42.5% from the bottom, inked all the way up after).
- **No React.** `pnpm dlx shadcn@latest add @magicui/text-reveal` cannot run here (the app has no `@astrojs/react` and no `react`); the component is hand-ported the way `TextShimmer` and `DotPattern` were, using the existing vanilla `motion` dependency.
- **Structure-preserving port.** Magic UI takes one flat string and splits it on spaces. This content is structured (two blocks, four rows each, one hard line break, one divider), so the component takes block data and applies the same per-word ink sweep to all 28 words in reading order.
- **Theme-aware black ↔ white ink.** One colour pair that swaps with the device scheme, using the repo's per-section CSS-variable idiom (dark authored as the baseline, `prefers-color-scheme: light` inverts). The unrevealed ghost floor sits at ~8% dark / ~10% light opacity — Magic UI's ~6% is invisible on the page's `#0a0a0a` — while still reading "almost invisible but readable if focused" per the demo.
- **Real font.** The site's `--font-sans` token named "Inter", which was never loaded anywhere, so the page silently fell back to system sans; the docs demo renders in **Geist** (variable 100–900), which is now loaded via `@fontsource-variable/geist` and the token updated to match.
- **BREAKING — `QuranVerse` is retired from the homepage.** The families section takes the slot the verse currently occupies (directly after the hero); the couple asked for the verse section to be removed once this lands. `QuranVerse.astro` is deleted and the `scroll-motion` requirements that govern it are withdrawn.

## Capabilities

### New Capabilities

- `families-section`: The hosts/families section — its exact copy, block layout and responsive stacking, device-theme colour pair, the position-driven reveal mechanism (ghost floor, centre-band ink ramp), the divider, no-overflow guarantees, and the reduced-motion / no-JS presentation.

### Modified Capabilities

- `scroll-motion`: **ADDED** — the families reveal's rules (position-driven, no pin; one style write per scroll frame; no layout reads in the scroll path; no scrub rebuild or re-measure on height-only resize; reduced motion / no-JS renders fully revealed). **MODIFIED** — "Pinned stages are sized to the chrome-hidden viewport" keeps FamiliesReveal out of the pinned set while still binding its `lvh` normalisation rule. **REMOVED** — "QuranVerse honors reduced motion" and "QuranVerse releases compositor hints after its reveal".

## Impact

- **Code**: new `apps/web/src/components/FamiliesReveal.astro`; `apps/web/src/pages/index.astro` (import + render the new section, drop `<QuranVerse />`); delete `apps/web/src/components/QuranVerse.astro`. `HeroZoom.astro` is untouched.
- **Dependencies**: `@fontsource-variable/geist` added (the font the design reference actually renders in). `motion@13` is already a dependency and already used by `TimelineScroll`, `ZoomParallax`, `WeddingFAQ` and `SlideToConfirm`. The shadcn/magicui CLI is deliberately not run.
- **Scroll budget**: the families section is content-height flow content, replacing the verse section's 100vh with roughly its own content height — net scroll length is approximately unchanged before `ZoomParallax` (the pinned-runway variant's +100vh never shipped).
- **Shared tokens**: `--ease-blur-reveal` in `global.css` is commented as QuranVerse's curve but is also consumed by `EventTimes`, so it survives the removal — verified, not assumed, so the motion-tokens "no dead tokens" requirement is not violated.
- **Content**: copy is exactly as supplied by the couple, with no added "Mempelai Pria/Wanita" labels (explicitly declined).
- **Verification**: Playwright asserts the travelling reveal (ghost below the band, ink at the band, inked all the way up, no sticky stage), no horizontal overflow at 320×568 and 375×667, the accessible text, the theme pair, the one-write-per-frame cost, and the reduced-motion / no-JS presentation. `apps/web/scripts/capture-scroll.mjs` has a families pass whose captures the reviewer eyeballs.
