# scroll-motion Spec Delta

## Purpose

Extends the scroll-driven set-piece requirements to the new families section (its position-driven reveal, per-frame performance discipline, and reduced-motion presentation), and withdraws the requirements that governed the retired QuranVerse section.

## ADDED Requirements

### Requirement: FamiliesReveal reveal is driven by viewport position, not a pinned runway

The FamiliesReveal section SHALL flow with the document — it SHALL NOT contain a sticky stage or a taller-than-content scroll runway — and each revealable unit (word or divider) SHALL map its ink to its own position in the viewport: at the ghost floor while its centre is below the reveal band (≈90% of the viewport down), ramping to full ink as its centre crosses the band (≈57.5% of the viewport down, ≈42.5% up from the bottom), and remaining at full ink as the unit continues travelling upward out of view. The mapping SHALL be driven by the container's scroll position without reading layout geometry per frame.

#### Scenario: Words ink as they cross the centre band

- **WHEN** the guest scrolls so the section travels up through the viewport
- **THEN** words below the band sit at a faint-but-readable ghost opacity, words crossing the band ramp toward full ink, and the reveal reads as a colour wave travelling up the copy

#### Scenario: Inked words stay inked while leaving the viewport

- **WHEN** a word has crossed the reveal band and the guest keeps scrolling down
- **THEN** the word remains at full ink opacity while it continues moving upward, and scrubbing back down returns it through the same ramp to the ghost floor

#### Scenario: No pinned stage

- **WHEN** the section is anywhere in the visible viewport
- **THEN** no descendant is `position: sticky` and the section's height is its content's height plus authored padding

### Requirement: FamiliesReveal scrub costs one style write per frame

The FamiliesReveal scrub SHALL advance by writing a single normalised scroll-position value to one registered CSS custom property on the section per animation frame, with each unit's opacity derived from that property and its own pre-measured document position in CSS. The per-frame work SHALL NOT scale with the number of revealed units, and scroll handling SHALL NOT read layout geometry. The scrub binding SHALL be scoped to the section's visibility so that scrolling far from the section performs no work for it.

#### Scenario: Word count does not multiply frame work

- **WHEN** the guest scrolls through the section after initialization
- **THEN** a maximum of one custom-property write occurs per animation frame and no `getBoundingClientRect()` read or per-word style assignment occurs as a result of a scroll event

#### Scenario: Scrolling far past the section is inert

- **WHEN** the section is more than one viewport away from the visible region and the guest scrolls
- **THEN** no style writes are performed for the families reveal

#### Scenario: Height-only resize does not rebuild the scrub

- **WHEN** mobile browser chrome collapses or retracts, emitting a height-only `resize` while the width is unchanged
- **THEN** the section's scrub binding and pre-measured unit positions are neither torn down nor re-measured

### Requirement: FamiliesReveal honors reduced motion

When the user prefers reduced motion, the FamiliesReveal section SHALL present both family blocks as static, fully-revealed content and SHALL NOT bind a scroll-driven scrub. The same fully-revealed presentation SHALL hold when JavaScript is unavailable or has failed to load.

#### Scenario: Reduced-motion guest reads the families

- **WHEN** `prefers-reduced-motion: reduce` is active and the guest scrolls to the section
- **THEN** all words of both blocks are at full ink opacity on arrival

#### Scenario: No-JS presentation

- **WHEN** the section renders without its script executing
- **THEN** the content is fully revealed and readable rather than permanently ghosted

## MODIFIED Requirements

### Requirement: Pinned stages are sized to the chrome-hidden viewport

The scroll runways and sticky stages of HeroZoom and ZoomParallax, and their viewport-height-dependent element positions, SHALL be sized in `lvh` (the large viewport: browser chrome hidden) with a `vh` fallback declaration — because every mobile browser retracts its URL bar on the first downward scroll, so the chrome-hidden viewport is the state a pinned sequence is actually watched in. TimelineScroll's sticky stage and scroll runway SHALL be sized in `svh` (with a `vh` fallback declaration) so the stage does not jump when browser chrome expands during reverse scrolling. FamiliesReveal's type sizing and its JS-normalised reveal units SHALL likewise be derived from `lvh`, never from the dynamic viewport. Runways and stage geometry SHALL NOT use `dvh`, and scroll-driven geometry derived in JavaScript SHALL NOT be measured from the dynamic viewport (`window.innerHeight`), because both re-resolve while browser chrome collapses and would change a scrub's length or alignment mid-scroll.

#### Scenario: Mobile browser with its URL bar retracted

- **WHEN** a guest scrolls into a pinned sequence on a mobile browser, so the URL bar has collapsed
- **THEN** each pinned stage fills the visible viewport exactly — no band of section background is exposed beneath a stage that was sized to a smaller viewport

#### Scenario: Browser chrome collapses during a scroll

- **WHEN** the URL bar retracts or reappears part-way through a pinned sequence
- **THEN** the section's scroll runway, stage height, and scrub-derived geometry are unchanged, so the sequence does not jump, and no set of scroll bindings is torn down and rebuilt in response to the height-only `resize`

#### Scenario: Browser without large-viewport units

- **WHEN** the browser does not support `lvh` units
- **THEN** the stages fall back to their `vh` sizes and remain functional (legacy `vh` already resolves to the large viewport on iOS Safari)

## REMOVED Requirements

### Requirement: QuranVerse honors reduced motion

**Reason**: The QuranVerse section is retired from the homepage by this change, so the requirement has no subject.

**Migration**: No replacement. The homepage slot the verse occupied is taken by FamiliesReveal, whose reduced-motion behaviour is specified by the "FamiliesReveal honors reduced motion" requirement added in this delta. The shared `--ease-blur-reveal` token the verse used is retained — `EventTimes` is a live consumer — so no motion token is orphaned by the removal.

### Requirement: QuranVerse releases compositor hints after its reveal

**Reason**: The QuranVerse section is retired from the homepage by this change, so the requirement has no subject.

**Migration**: No replacement. The equivalent discipline for the new section is carried by "FamiliesReveal scrub costs one style write per frame", which achieves the terminal-state cost profile by deriving word opacity in CSS from one scrubbed property rather than by hinting and then releasing per-word compositor layers.
