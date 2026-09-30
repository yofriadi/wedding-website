## 1. Markup & Styling Updates

- [x] 1.1 Add opacity transition classes, load/error markers, and updated header documentation to timeline images in `TimelineScroll.astro` (`opacity-0 transition-opacity duration-300 data-[loaded=true]:opacity-100` with inline `onload="this.dataset.loaded='true'"` and `onerror="this.dataset.loaded='true'"`).
- [x] 1.2 Add progressive enhancement and reduced motion CSS overrides in `TimelineScroll.astro`: add `<noscript><style>.timeline-node img { opacity: 1 !important; }</style></noscript>` twin alongside `@media (scripting: none)` and `@media (prefers-reduced-motion: reduce)` to ensure `.timeline-node img { opacity: 1 !important; }`.

## 2. Client-Side Approach Preloader

- [x] 2.1 Implement `preloadTimelineImages()` in `TimelineScroll.astro` to promote `loading="lazy"` images to `loading="eager"`, trigger `img.decode()`, and update `data-loaded`.
- [x] 2.2 Hook `preloadTimelineImages()` into the existing `#timeline-section` `IntersectionObserver` (`rootMargin: "100% 0px"`).

## 3. Verification & Quality Assurance

- [x] 3.1 Verify initial page load in browser: confirm timeline images are not requested while above the fold.
- [x] 3.2 Verify section approach: confirm images are requested and decoded as the visitor reaches approach distance of `#timeline-section`.
- [x] 3.3 Verify horizontal scrub: confirm Node 2, Node 3, and Node 4 cards open with decoded images and zero empty-frame flashes.
- [x] 3.4 Run repository linting, type-checking, tier harness, and build (`pnpm run check`, `pnpm run check-types`, `pnpm --filter web run test:tier-harness`, `pnpm run build`).
