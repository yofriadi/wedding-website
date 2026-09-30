# progressive-enhancement Delta Specification

## MODIFIED Requirements

### Requirement: Delivered markup is complete without JavaScript

The document the server delivers SHALL present its full textual content and a visible representation of every media position with JavaScript disabled or not yet executed. No content region SHALL depend on a script running to become present in the render tree. Every layer that covers the viewport and is dismissed by script — the loading screen and the welcome gate among them — SHALL be suppressed without script by the idiom already used elsewhere in the repository (a `<noscript>` style override, with an `@media (scripting: none)` twin), so an engine that never runs the script is never left behind an overlay. Suppression is the requirement, not inversion: these layers are legitimately rendered in delivered markup and _removed_ by script for the scripted experience, so they SHALL NOT be required to ship hidden.

Terminal, non-dismissed layout gates displayed by pure CSS media queries — specifically `DesktopGate` on viewports $\ge 768\text{px}$ width and $\ge 600\text{px}$ height — are exempt from script-dismissal suppression: `DesktopGate` is displayed by CSS, is not dismissed by script, and delivers its complete content (monogram, prompt, and server-rendered SVG QR code) without JavaScript so that a no-JS desktop visitor is fully guided to open the invitation on their mobile device without being trapped.

#### Scenario: Text survives a script blocker

- **WHEN** the page is loaded on an ungated mobile viewport with JavaScript disabled
- **THEN** every heading, paragraph, and label the site intends to show is visible

#### Scenario: Every media position shows something

- **WHEN** the page is loaded with JavaScript disabled
- **THEN** no image element is without a fetchable source, and no media position renders as an empty box

#### Scenario: An overlay never traps a no-script guest

- **WHEN** the page is loaded with JavaScript disabled and a script-dismissed full-viewport overlay is present in markup
- **THEN** the overlay is not rendered and the content beneath it is reachable, including the loading screen, which is dismissed only by script

#### Scenario: Desktop gate presents full content without JavaScript

- **WHEN** the page is loaded on a desktop viewport with JavaScript disabled
- **THEN** `DesktopGate` displays its message and server-rendered SVG QR code, directing the visitor to mobile without requiring script execution
