## ADDED Requirements

### Requirement: HeroZoom CSS animation declarations are minification-safe

HeroZoom's scroll-driven animation declarations SHALL maintain valid CSS in both development and production minified builds. Declarations combining animation properties with `animation-timeline` SHALL NOT be collapsed into the CSS `animation` shorthand with timeline identifiers, ensuring browsers that support named scroll timelines parse and execute the scroll animations for all hero layers.

#### Scenario: Production build CSS validation

- **WHEN** the production site is built with `astro build`
- **THEN** the resulting CSS bundle contains valid `animation-timeline` declarations for `.animate-image`, `.animate-blur`, `.animate-overlay`, and all title lockup elements, and no declaration combines `<timeline-name>` into the `animation` shorthand

#### Scenario: Scroll-driven animation execution in supported browsers

- **WHEN** a user visits on a browser supporting named view timelines and scrolls through the hero
- **THEN** `.animate-blur`, `.animate-overlay`, and the title lockup elements execute their scroll animations driven by `--hero-progress` rather than displaying their static fallback state at scroll 0

### Requirement: HeroZoom scroll animation scrubs across the pinned runway

The HeroZoom image zoom-out and text reveals SHALL scrub proportionately across the pinned section runway. The zoom-out transition SHALL remain active through the designated zoom phase of the pinned travel and SHALL NOT finish prematurely or freeze into a static state while the stage remains pinned.

#### Scenario: Image zoom progress during runway scroll

- **WHEN** the user scrolls from scroll 0 through the zoom phase
- **THEN** `.animate-image` transforms smoothly from `scale(1.75)` down to `scale(1)` mapped to the runway travel, holding at `scale(1)` only after the zoom phase completes

#### Scenario: Sequential reveal progression

- **WHEN** the user continues scrolling past the zoom phase through the pinned travel
- **THEN** the couple names, ampersand, event label, and date reveal sequentially in synchrony with the scroll position before the section unpins

#### Scenario: JavaScript fallback scrub parity

- **WHEN** a browser without named view-timeline support executes the JavaScript scroll fallback
- **THEN** the image zoom-out easing matches the CSS `--ease-out-zoom` curve and the reveal phase boundaries align with the CSS keyframe distribution
