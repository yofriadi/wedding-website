# scroll-motion Spec Delta

## MODIFIED Requirements

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline story beat in a readable vertical layout — explicitly including the opening title ("Mula-mula"), node 1, and the finale dot (dot-9) alongside its label — with no scroll-driven circle, pan, or reveal animations and no pinned scroll region. Content hidden inline for the animated run SHALL be force-revealed by the reduced-motion CSS; no reveal may depend on the animated script, which does not run under reduced motion.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** the opening title ("Mula-mula"), all nine nodes' dots, dates, photos, and descriptions — node 1 and the node-9 finale dot included — and the finale label ("10 October 2026 / Menikah") are visible in document order as a vertical flow, the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the pinned runway

#### Scenario: No scroll-driven bindings under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is active and the page script initializes
- **THEN** the TimelineScroll script binds no `animate()`/`scroll()` scrub animations to the track, overlays, or nodes — so any content whose inline hidden state is cleared only by that script (e.g. node 1's `visibility`, dot-9's `opacity`) MUST be revealed by CSS instead

#### Scenario: The finale anchor stays hidden on both paths

- **WHEN** either the animated or the reduced-motion presentation renders
- **THEN** `#dot-9-anchor` remains non-visible (it is a measurement point for the finale pan, never meant to paint)

## ADDED Requirements

### Requirement: QuranVerse releases compositor hints after its reveal

The QuranVerse word spans' `will-change` hint SHALL apply only until the reveal completes; the terminal (`.in-view`) state SHALL clear it (`will-change: auto`) so compositor layers are not held for the rest of the page session.

#### Scenario: After the reveal settles

- **WHEN** the verse section has entered the viewport and the word reveal has completed
- **THEN** each revealed word's computed `will-change` is `auto`, and the reveal itself played with the hint active
