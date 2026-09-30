## ADDED Requirements

### Requirement: Timeline photos preloaded on section approach

Client-side execution SHALL initiate pre-fetching and decoding of timeline photos when the guest scrolls within approach distance of `#timeline-section`. Delivered server markup for these photos SHALL retain `loading="lazy"` to protect initial page load and hero LCP bandwidth.

#### Scenario: Approaching the timeline section triggers image pre-decode

- **WHEN** the guest scrolls into approach distance of the timeline section (within 1 viewport height)
- **THEN** client-side script promotes timeline `img` elements to eager loading and triggers `img.decode()` on their candidates

#### Scenario: Initial page load does not fetch timeline images

- **WHEN** the page completes initial load while remaining at the top of the document
- **THEN** no network requests are issued for timeline photos
