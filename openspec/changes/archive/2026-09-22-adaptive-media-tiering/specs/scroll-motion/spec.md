# scroll-motion

Delta for `adaptive-media-tiering`. Two archived requirements assume the ZoomParallax tunnel zoom runs for every motion-permitted visitor and that `DOMContentLoaded` is its only initializer. The media tier breaks both assumptions: a `lite` or `pending` verdict presents the same static grid as reduced motion without the guest asking for reduced motion, and the head script's measurement can resolve between module evaluation and `DOMContentLoaded`.

## MODIFIED Requirements

### Requirement: ZoomParallax honors reduced motion

When the user prefers reduced motion, the ZoomParallax component SHALL present the bento grid as static content: no scroll-driven zoom animation is bound, the section collapses to a single viewport of height, and the stage is not pinned. The identical static presentation SHALL apply while the media tier is `lite` or `pending` (see the `media-tiering` capability), whether or not reduced motion was requested, and while the media tier is absent from the document entirely the component SHALL behave as it does on a `full` tier.

#### Scenario: Reduced-motion user scrolls past the grid

- **WHEN** `prefers-reduced-motion: reduce` is active and the user scrolls through the ZoomParallax section
- **THEN** every image remains at its natural grid scale, no wrapper receives a scroll-driven transform, and the section occupies exactly one viewport of scroll distance

#### Scenario: Motion-permitted user scrolls the grid on a full tier

- **WHEN** reduced motion is not requested, the media tier is `full`, and the user scrolls through the ZoomParallax section
- **THEN** the existing tunnel zoom sequence runs unchanged (wrappers scale per their data-scale targets, center image scales to fill)

#### Scenario: Motion-permitted user scrolls the grid on a lite tier

- **WHEN** reduced motion is not requested and the media tier is `lite` or `pending`
- **THEN** no wrapper receives a scroll-driven transform, the stage is not pinned, and the section occupies exactly one viewport of scroll distance

#### Scenario: Tier downgrades mid-scroll

- **WHEN** the media tier downgrades from `full` to `lite` while the guest is scrolling the section
- **THEN** the scroll-driven transforms stop, every wrapper returns to its natural grid scale, and the section collapses to one viewport

### Requirement: ZoomParallax initializes exactly once per page load

On initial page load the ZoomParallax component SHALL bind its scroll-driven animations exactly once: one live set of scroll bindings and one layout flush. Initialization is no longer driven by `DOMContentLoaded` alone — a `net-tier:change` resolution may arrive first, because the head script's measurement can settle between module evaluation and `DOMContentLoaded`. Whichever of the two runs first SHALL create the bindings and the other SHALL NOT create a second set. A `resize` that changes the viewport width MAY rebuild the bindings; a height-only resize SHALL NOT. The flush count is an implementation consequence rather than an observable contract: tests SHOULD assert the visible outcome (one promotion, a correct zoom sequence, no duplicated transform writes) rather than the number of layout flushes.

#### Scenario: Initial page load

- **WHEN** the page finishes its initial load with the media tier already resolved
- **THEN** ZoomParallax initialization binds exactly once (one set of scroll bindings, one layout flush)

#### Scenario: Tier resolves before DOMContentLoaded

- **WHEN** a `pending` media tier resolves to `full` after the component's module has been evaluated but before `DOMContentLoaded` fires
- **THEN** the collage is promoted once and the zoom sequence runs correctly, with only one live set of scroll bindings and no duplicated transform writes

#### Scenario: Tier resolves after initialization

- **WHEN** a `pending` media tier resolves to `full` after `DOMContentLoaded` with no bindings live
- **THEN** one set of scroll bindings is created at resolution
