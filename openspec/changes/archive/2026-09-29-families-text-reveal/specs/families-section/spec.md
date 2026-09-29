# families-section Spec Delta

## Purpose

The hosts' families section on the homepage: two family blocks — the parents' names, a hairline divider, and the family address — that travel up through the viewport with the document while each word inks as it crosses the viewport's centre band, in the spirit of Magic UI's `text-reveal` docs demo (the variant where the copy moves with the scroll while the colour sweep crosses it). It carries structured content instead of one flat string, and follows the device colour scheme with a single black ↔ white pair.

## ADDED Requirements

### Requirement: Family block content

The families section SHALL render exactly two family blocks, in this order, with this copy verbatim and no added, translated, or embellished text:

- Block one: heading `Keluarga`; `Bapak Ch. Fuad Ery Pribadi`; `Ibu Siti Mufrodah`; address `Jl. Dr. Wahidin 49, Surakarta`.
- Block two: heading `Keluarga`; `Bapak Hermansyah`; `Ibu Nur Faizah`; address `Jl. Kemanggisan Ilir No. 58a,` followed by a hard line break and `Palmerah, Jakarta Barat`.

The section SHALL NOT label either block by role (no "Mempelai Pria"/"Mempelai Wanita" or equivalent), and SHALL NOT introduce names, titles, or honorifics that are not in the copy above.

#### Scenario: Copy ships verbatim

- **WHEN** the homepage HTML is delivered
- **THEN** all twenty-eight words of both blocks are present in the server-rendered response in block order, with no additional descriptive text

#### Scenario: Authored address break survives

- **WHEN** block two's address renders
- **THEN** `Palmerah, Jakarta Barat` begins a new line that is not the result of the container wrapping `Jl. Kemanggisan Ilir No. 58a,` — the break is preserved at every supported viewport width

### Requirement: Section placement in the homepage composition

The families section SHALL render immediately after the hero section, and the QuranVerse section SHALL no longer be part of the homepage composition or the source tree.

#### Scenario: Reading order

- **WHEN** the homepage renders
- **THEN** the section directly following `HeroZoom` is the families section, followed by `ZoomParallax`

#### Scenario: Verse section is retired

- **WHEN** the repository is built
- **THEN** the homepage imports and renders no `QuranVerse` component and no `QuranVerse.astro` source file remains

### Requirement: Responsive block layout

Below the medium breakpoint the two family blocks SHALL stack vertically in block order; at the medium breakpoint and above they SHALL sit side by side as two equal columns. Each block SHALL be centre-aligned, and each block's heading SHALL be visually distinguished from the parents' names, which SHALL be distinguished from the address.

#### Scenario: Stacked on a phone

- **WHEN** the section renders at a 375px viewport width
- **THEN** block two sits entirely below block one and both are horizontally centred

#### Scenario: Columned on a desktop

- **WHEN** the section renders at a 1440px viewport width
- **THEN** the blocks occupy two side-by-side columns of equal width with a visible gutter between them

### Requirement: Revealed content does not overflow

At every supported viewport the section's content SHALL render without clipping, horizontal overflow, or scrollable descendants. Type sizing SHALL be derived from the viewport height as well as the width, so the heading/names/address hierarchy stays proportionate on short viewports where a width-only ramp would read too large.

#### Scenario: Phone-width fit

- **WHEN** the section is rendered at 320×568 and at 375×667 with the reveal complete
- **THEN** no horizontal overflow exists at the document or section level and the body type stays at or above roughly 0.85rem

#### Scenario: Long address line does not overflow horizontally

- **WHEN** block two's address renders at 320px viewport width
- **THEN** no word is clipped or pushed outside the section's horizontal padding

### Requirement: Device-theme ink pair

The section SHALL present a single ink colour pair that follows the device colour scheme: black ink on a light surface, white ink on a dark surface. Dark SHALL be the authored baseline and the light scheme SHALL be expressed as an inversion of it, following the repo's per-section CSS custom-property idiom. The section SHALL paint its own background and SHALL NOT inherit the document body's. Every painted element in the section — heading, names, address, and divider — SHALL derive its colour from that pair; no colour SHALL be hard-coded per element.

#### Scenario: Light device scheme

- **WHEN** `prefers-color-scheme: light` is active
- **THEN** the section's surface is light and all of its text is the black ink

#### Scenario: Dark device scheme

- **WHEN** the device reports a dark colour scheme
- **THEN** the section's surface is the dark baseline and all of its text is the white ink

#### Scenario: Scheme changes at runtime

- **WHEN** the device colour scheme changes while the page is open
- **THEN** the section re-colours through the CSS custom properties with no script involvement and no reload

### Requirement: Single-tier position-driven word reveal

Each word SHALL be painted once, and its opacity SHALL be driven by its own position in the viewport: at a constant ghost alpha (faint, still readable) while its centre is below the reveal band, ramping to full ink as its centre crosses the band, and holding full ink above it. Because the words travel with the document, the sweep reads as a colour wave moving up the copy. The ghost floor SHALL be deliberate — Magic UI's ~0.06 baseline sits within a few codes of the section's dark surface and would make unrevealed words invisible rather than ghosted. At the end of the reveal the words SHALL be indistinguishable from fully opaque text.

#### Scenario: Unrevealed words stay legible as ghosts

- **WHEN** a word's centre is below the reveal band
- **THEN** that word occupies its final layout position and is visible at the ghost alpha — it does not shift, reflow, or disappear entirely

#### Scenario: Revealed words reach full ink

- **WHEN** a word's centre has crossed the reveal band
- **THEN** that word renders at full ink opacity and stays at full ink as it continues travelling upward

#### Scenario: Assistive technology hears each word once

- **WHEN** the section's content is exposed to an assistive technology
- **THEN** each word is announced exactly once, in block order — Magic UI's duplicated-word markup is not ported

### Requirement: Reveal tracks scroll in both directions

The reveal SHALL be a pure function of scroll position: scrolling down reveals words as they rise into the band, and scrolling back up un-reveals them through the same ramp. The reveal SHALL NOT be a forward-only animation.

#### Scenario: Scrubbing backwards un-reveals

- **WHEN** the guest scrolls back up through the section
- **THEN** word opacity tracks the scroll position in reverse rather than replaying a forward-only animation
