## MODIFIED Requirements

### Requirement: Tier-driven promotion of deferred collage media

The ZoomParallax collage images SHALL ship with a live low-fidelity `src` in every case — a placeholder small enough to arrive on the link the full asset would have been withheld from — together with intrinsic dimensions, alt text, and the full-resolution candidates held in `data-src`/`data-srcset`. Deferral SHALL reduce resolution, never remove a source: no tier SHALL produce a collage image element without a fetchable `src`, so a `lite` guest sees the collage at low fidelity rather than as empty frames. On a `full` tier at parse time the deferred candidates SHALL be promoted to live attributes synchronously during the initial parse, so their fetches start as early as markup-shipped sources would. On a `pending` tier the promotion SHALL happen when the tier resolves to `full`. On a `lite` tier each image SHALL be promoted when the collage approaches the viewport (intersection with a generous margin), and not before. Promotion SHALL overwrite the placeholder `src` with the full-resolution candidate and SHALL mark the element promoted; that marker, not the presence or absence of a `src`, is the sole idempotency mechanism, because every image now has a `src` from the moment it parses. Promotion SHALL therefore be idempotent against the marker, and promoting an image whose placeholder has already painted SHALL swap the candidate without changing the element's box. Both promoters the page ships — the component's and the inline parse-time copy — SHALL apply the same marker and the same overwrite. The promotion margin is measured once when the observer is created and re-measured if the viewport changes; it is not scroll-scrub geometry and MAY derive from the viewport height — a deliberate carve-out from `scroll-motion`'s prohibition on measuring JS-derived scroll geometry from the dynamic viewport. Because all ten images sit inside one collapsed viewport-height box they intersect together, so the per-image observer satisfies "promoted when the collage approaches" without delivering per-photo granularity.

#### Scenario: Full tier fetches at parse time

- **WHEN** the tier is `full` during the initial parse
- **THEN** every collage image carries a live full-resolution `src` and `srcset` immediately after the collage markup parses

#### Scenario: Lite tier pays per approach

- **WHEN** the tier is `lite` from the initial verdict and the guest has not scrolled near the collage
- **THEN** each collage image carries its live placeholder `src`, and no full-resolution collage candidate is transferred

#### Scenario: No tier produces an empty frame

- **WHEN** the delivered document is inspected on any tier, with or without JavaScript
- **THEN** every collage image element has a fetchable `src` and none renders as an empty box

#### Scenario: Lite guest scrolls to the collage

- **WHEN** a lite guest scrolls the collage within the promotion margin
- **THEN** the collage images receive their full-resolution candidates and upgrade in place, with no change to their boxes

#### Scenario: Pending resolves full behind the loader

- **WHEN** a pending tier resolves to `full` while the loading screen is still up
- **THEN** the collage candidates are promoted at resolution, before the gate can open

#### Scenario: Downgrade does not un-promote

- **WHEN** a `full` tier promoted the collage at parse time and the measurement then downgrades the tier to `lite`
- **THEN** the promoted sources stay live — in-flight `<img>` cancellation is unreliable across engines — so the downgrade changes layout and bindings, not what was already fetched

#### Scenario: Placeholder is not re-fetched after promotion

- **WHEN** an image has been promoted to its full-resolution candidate
- **THEN** a later pass over the promoted markup is a no-op and issues no further requests, because the promotion marker — not the presence of a `src` — is what excludes it
