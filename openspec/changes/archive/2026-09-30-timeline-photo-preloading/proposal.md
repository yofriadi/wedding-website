## Why

Timeline photos in `TimelineScroll.astro` are positioned horizontally across an ultra-wide track at `260vw` (Node 2), `470vw` (Node 3), and `680vw` (Node 4). Because the delivered markup carries `loading="lazy"`, modern browser engines treat these nodes as deeply off-screen and withhold network requests during initial load and even after the user enters the timeline section.

When the visitor scrubs vertically, the track translates horizontally via CSS transforms. The browser only initiates an image request once the transform pulls the node into (or adjacent to) the physical viewport. Because the node's photo card reveal animation executes immediately (`REVEAL_WINDOW = 0.0188`, ~21vh of scroll), the card pops open with an empty dark background (`--timeline-photo-frame`), and the photo flashes or abruptly pops into view moments later once the network transfer and asynchronous decoding finish.

Preloading and decoding the responsive candidate images as the visitor approaches `#timeline-section` eliminates this empty-frame delay while preserving `loading="lazy"` in server-rendered markup to protect initial page load and hero LCP performance.

## What Changes

- **Approach-Triggered Image Preload & Pre-decode**: When the visitor scrolls within approach distance of `#timeline-section` (via its existing `IntersectionObserver` with `rootMargin: "100% 0px"`), client-side execution promotes the timeline `<img>` elements to eager loading and triggers `img.decode()` on each candidate.
- **Smooth Image Opacity Transition**: Timeline images transition from `opacity-0` to `opacity-100` smoothly (`transition-opacity duration-300`) upon load, preventing abrupt flashing if a user scrolls rapidly on a slow network before decoding settles. Cached and pre-decoded images render at full opacity immediately.
- **Progressive Enhancement & Motion Safety**: Delivered server markup retains standard `loading="lazy"`, responsive `<picture>` candidates, intrinsic dimensions, and full `src`/`srcset`. Non-scripted and reduced-motion environments display photos without transition delays (`opacity: 1 !important`).

## Capabilities

### New Capabilities

_(None)_

### Modified Capabilities

- `responsive-media`: Clarifies that while below-fold timeline photos ship with `loading="lazy"` in delivered server markup, client-side code promotes them to eager and initiates pre-decoding upon section approach to avoid empty-frame rendering during horizontal scrub.
- `scroll-motion`: Requires TimelineScroll to pre-decode its photo candidates on section approach and transition image opacity smoothly to eliminate jarring pop-in during node reveals.

## Impact

- **Frontend components**: `apps/web/src/components/TimelineScroll.astro`.
- **Specs**: Delta specs in `openspec/changes/timeline-photo-preloading/specs/{responsive-media,scroll-motion}/spec.md`.
- **Dependencies**: No new dependencies.
- **Performance**: Zero regression on initial load, loading screen duration, or hero LCP; total payload for the 3 timeline images on mobile is under 45 KB, fetched in the background across ~325lvh of runway before Node 2 reveals.
