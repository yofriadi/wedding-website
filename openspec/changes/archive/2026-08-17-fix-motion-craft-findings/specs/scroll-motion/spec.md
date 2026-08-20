## MODIFIED Requirements

### Requirement: Timeline node reveals reverse consistently

Each TimelineScroll node's photo, date, and description SHALL be driven by the same reveal mechanism, so scrubbing backward never leaves a node's photo in a different visibility state than its text — and the reveal itself scrubs with scroll in both directions (a forward burst does not replay when scrolling back).

#### Scenario: Scrubbing backward through a connected node

- **WHEN** the user scrolls forward past a node's connect threshold and then scrolls backward past its disconnect threshold
- **THEN** the node's photo, date, and description hide through the same threshold path with no residual visible state

#### Scenario: Scrubbing forward through a connect threshold

- **WHEN** the user scrolls forward past a node's connect threshold
- **THEN** the node's photo, date, and description reveal with the existing staggered, overshoot-eased timing

#### Scenario: Reverse scrubbing plays the reveal in reverse

- **WHEN** the user scrolls backward through a node that is currently revealing
- **THEN** the node's reveal progress tracks the scroll position (scrubbed), rather than continuing or restarting a time-based forward animation

## RENAMED Requirements

### Requirement: Timeline finale grows from an infinitesimal seed

The TimelineScroll closing expansion circle SHALL grow from an infinitesimal scale seed (sub-pixel, e.g. `0.001`) rather than appearing from `scale(0)`, so the final "Menikah" reveal grows from the timeline's end dot instead of popping into existence.

#### Scenario: Reaching the end of the timeline

- **WHEN** the user scrubs past the final node toward the end of the section
- **THEN** the black closing circle visibly grows outward from the timeline's end dot — at no point does it switch abruptly from invisible to visible at a finite size

### Requirement: QuranVerse honors reduced motion

When the user prefers reduced motion, the QuranVerse section SHALL present its text as fade-in without per-word movement or per-word delay staggering, and its ambient looping animations (float, pulse) SHALL be disabled.

#### Scenario: Reduced-motion user reads the verse

- **WHEN** `prefers-reduced-motion: reduce` is active and the verse section enters the viewport
- **THEN** the Arabic text and translation fade in as whole groups (≤200ms opacity-only transitions, no `translateY` per word, no word-index delay stagger), and the ambient blur blob and radial glow are static

#### Scenario: Motion-permitted user reads the verse

- **WHEN** reduced motion is not requested
- **THEN** the word-by-word rising reveal and ambient float/pulse animations run as they do today
