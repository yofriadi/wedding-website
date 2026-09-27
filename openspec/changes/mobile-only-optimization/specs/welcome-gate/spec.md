# welcome-gate Delta Specification

## MODIFIED Requirements

### Requirement: Non-touch dismissal

On viewports where `DesktopGate` is active ($\ge 768\text{px}$ width and $\ge 600\text{px}$ height), `WelcomeGate` SHALL NOT arm or listen to wheel or mouse events behind the blocking desktop gate. Non-touch dismissal (wheel, click, keydown) remains supported for keyboard-navigated mobile devices, assistive technologies, and testing fixtures on mobile viewports ($< 768\text{px}$ width or $< 600\text{px}$ height).

#### Scenario: Desktop input behind DesktopGate does not commit reveal

- **WHEN** a desktop visitor scrolls or presses keys while `DesktopGate` is displayed
- **THEN** `WelcomeGate` does not commit its reveal, does not unlock audio, and does not fire `POST /api/invite/opened` behind the gate

#### Scenario: Wheel dismisses on ungated viewports

- **WHEN** a visitor scrolls with a wheel or trackpad on an ungated viewport ($< 600\text{px}$ height or $< 768\text{px}$ width) while the gate is armed
- **THEN** the gate dismisses and the page scrolls normally afterwards

### Requirement: Scroll locked while armed

The homepage scroll lock SHALL begin when the gate's inline script first runs (during initial HTML parse, while the loading overlay may still be up) and SHALL hold — through loading and arming — until reveal commit. While the lock is active, the page behind the gate SHALL NOT scroll, zoom, or rubber-band, and the hero SHALL remain at its scroll-zero (initial, fully zoomed) state. The lock SHALL release only as part of the gate's exit (reveal commit or a dismissal path).

Rationale for the widened window: the loading overlay gates on media fetches (hero image, audio, timeline photos) and can outlive DOMContentLoaded on a slow network, while the gate arms only after the overlay is removed. Without a lock that starts at first script run, a window exists between page parse and gate arming in which the raw page behind the overlay scrolls — the mid-timeline landing this requirement exists to prevent. Gesture binding, inert, and the failsafe cancel remain arm-time behaviors; only the scroll lock moves earlier.

On viewports where `DesktopGate` is active ($\ge 768\text{px}$ width and $\ge 600\text{px}$ height), `WelcomeGate` SHALL NOT latch `overflow: hidden` permanently. If a visitor resizes their window from desktop to an ungated mobile viewport, `WelcomeGate` SHALL evaluate its arming condition dynamically and apply its normal scroll-lock and gesture-reveal behaviors.

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

#### Scenario: Resize from desktop restores normal mobile gate lifecycle

- **WHEN** a desktop visitor resizes their window below the desktop gate threshold ($< 768\text{px}$ width or $< 600\text{px}$ height)
- **THEN** `DesktopGate` hides, `WelcomeGate` arms normally, and the mobile scroll lock and gesture listeners are activated
