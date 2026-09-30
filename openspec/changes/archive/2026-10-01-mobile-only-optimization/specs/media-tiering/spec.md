# media-tiering Delta Specification

## MODIFIED Requirements

### Requirement: Tier-driven promotion of deferred collage media

The ZoomParallax collage images SHALL ship with low-fidelity LQIP placeholders in `src`/`srcset` and deferred master sources in `data-src`/`data-srcset`. On a `full` tier at parse time on non-gated mobile viewports the deferred sources SHALL be promoted to live attributes synchronously during the initial parse, so their fetches start as early as markup-shipped sources would. On desktop viewports where `DesktopGate` is displayed (`<html data-desktop>` present), collage promotion (both the parse-time copy and `ZoomParallax.astro`'s component promoter) SHALL be suppressed to prevent downloading heavy collage media behind the gate. On a `lite` tier each image SHALL be promoted when the collage approaches the viewport (intersection with a generous margin), and not before. Promotion SHALL mark the element with `data-promoted`; that marker, not the presence or absence of a `src`, is the sole idempotency mechanism, because every image now has a live placeholder `src` from the moment it parses. Both promoters the page ships — the component's and the inline parse-time copy — SHALL apply the same marker. The promotion margin is measured once when the observer is created and re-measured if the viewport changes; it is not scroll-scrub geometry and MAY derive from the viewport height — a deliberate carve-out from `scroll-motion`'s prohibition on measuring JS-derived scroll geometry from the dynamic viewport.

#### Scenario: Full tier fetches at parse time

- **WHEN** the tier is `full` during the initial parse on an ungated mobile viewport
- **THEN** every collage image is promoted immediately after the collage markup parses

#### Scenario: Desktop gate suppresses collage promotion

- **WHEN** the page loads on a desktop viewport where `data-desktop` is set
- **THEN** collage promotion does not run (neither parse-time nor component-level), and collage images remain unpromoted

#### Scenario: Lite tier pays per approach

- **WHEN** the tier is `lite` from the initial verdict and the guest has not scrolled near the collage
- **THEN** no collage image is promoted and no full-resolution collage bytes are transferred

#### Scenario: Lite guest scrolls to the collage

- **WHEN** a lite guest scrolls the collage within the promotion margin
- **THEN** the collage images are promoted and full-resolution assets load

#### Scenario: No tier produces an empty frame

- **WHEN** the page renders on any tier
- **THEN** every collage slot displays a low-fidelity placeholder before its full-resolution asset resolves

#### Scenario: Placeholder is not re-fetched after promotion

- **WHEN** an image has been promoted to its full-resolution candidate
- **THEN** a later pass over the promoted markup is a no-op and issues no further requests, because the promotion marker — not the presence of a `src` — is what excludes it

### Requirement: Soundtrack is tier-conditional

The soundtrack element SHALL ship with `preload="none"`. On a `full` tier on ungated mobile viewports, the page SHALL enable eager preloading 1200 ms after parse (before the loading screen's 2600 ms minimum dwell finishes) and SHALL start playback at the welcome-gate commit. On desktop viewports where `DesktopGate` is displayed (`<html data-desktop>` present), soundtrack preloading and playback SHALL be suppressed. On a `lite` tier the page SHALL NOT download the soundtrack at all: no preloading, no playback at commit, and no gesture-armed fallback; and the gate's music note SHALL be hidden so no playback is promised.

#### Scenario: Full tier buffers behind the gate

- **WHEN** a full-tier guest waits through the loading screen and gate on an ungated mobile viewport
- **THEN** the soundtrack preloads in the background and begins at the commit gesture

#### Scenario: Desktop visitor does not download soundtrack

- **WHEN** a full-tier visitor views the homepage on a desktop viewport with `data-desktop` present
- **THEN** no network request is issued for the soundtrack file

#### Scenario: Lite from the initial verdict transfers zero soundtrack bytes

- **WHEN** a guest whose verdict is `lite` opens the gate and browses the page
- **THEN** no request for the soundtrack file is made during the pageview
