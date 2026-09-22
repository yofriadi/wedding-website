# welcome-gate Spec Delta

## MODIFIED Requirements

### Requirement: Scroll locked while armed

The homepage scroll lock SHALL begin when the gate's inline script first runs (during initial HTML parse, while the loading overlay may still be up) and SHALL hold — through loading and arming — until reveal commit. While the lock is active, the page behind the gate SHALL NOT scroll, zoom, or rubber-band, and the hero SHALL remain at its scroll-zero (initial, fully zoomed) state. The lock SHALL release only as part of the gate's exit (reveal commit or a dismissal path).

Rationale for the widened window: the loading overlay gates on media fetches (hero image, audio, timeline photos) and can outlive DOMContentLoaded on a slow network, while the gate arms only after the overlay is removed. Without a lock that starts at first script run, a window exists between page parse and gate arming in which the raw page behind the overlay scrolls — the mid-timeline landing this requirement exists to prevent. Gesture binding, inert, and the failsafe cancel remain arm-time behaviors; only the scroll lock moves earlier.

#### Scenario: Scroll attempts do nothing

- **WHEN** the user swipes or wheels while the gate is armed
- **THEN** the document scroll position stays at 0 until the reveal commits

#### Scenario: The hero holds its initial state through the reveal

- **WHEN** the gate is armed and then dismissed at scroll zero
- **THEN** the hero stays fully zoomed in (its scroll-zero state) on every frame before, during, and after the gate's exit — the scroll lock never deactivates the hero's scroll-driven timeline, so its fully-revealed end state is never briefly shown

#### Scenario: The lock covers the loading overlay phase

- **WHEN** the loading overlay is still visible — including on a slow network where the overlay outlives DOMContentLoaded because it gates on media fetches
- **THEN** the document scroll position is 0 and the root scroll lock is already active — no window exists between page parse and gate arming in which the page behind the overlay scrolls

#### Scenario: The lock releases with the gate

- **WHEN** the gate exits by reveal commit or any dismissal path (reduced-motion tap, Escape, desktop wheel/click/keydown)
- **THEN** the scroll lock is released as part of that exit, and the page behind scrolls normally from scroll zero
