## ADDED Requirements

### Requirement: ZoomParallax scrollback resets transforms cleanly to baseline

When a user scrolls through and then reverses back to the start of the `ZoomParallax` runway (scroll progress <= 0.1, the initial dwell range), all `.zoom-wrapper` elements SHALL clear their inline transform style (`style.transform = ""`), returning their computed transform to `none`. Wrappers SHALL NOT retain persistent `scale(1)` inline transforms at rest, ensuring that browser compositors release the GPU transform layer and render collage images at native 1:1 pixel density, matching the reduced-motion baseline.

#### Scenario: User scrolls forward and then scrolls back to top

- **WHEN** a user scrolls forward through `ZoomParallax` to scale the photos and subsequently scrolls back up to the top of the section
- **THEN** every `.zoom-wrapper` clears its inline transform style, computing to `transform: none`
- **AND** all collage images return to their initial crisp bento grid layout without lingering layer distortion or scaling artifacts

### Requirement: ZoomParallax collage wrappers avoid permanent compositor scale-freeze

ZoomParallax `.zoom-wrapper` elements SHALL NOT declare permanent `will-change: transform` layerization hints that freeze raster textures in browser GPU compositors.

#### Scenario: Reverse scroll image fidelity in Chromium

- **WHEN** a user scrolls back up into the `ZoomParallax` section in a Chromium browser
- **THEN** surrounding collage images do not exhibit GPU texture scale-freeze, blur, or downsampling distortion as they scale back down toward baseline

### Requirement: ZoomParallax picture elements establish block containment

The `<picture>` elements inside `.zoom-inner` SHALL establish a block-level container (`display: block; width: 100%; height: 100%`), ensuring that percentage height and `object-fit: cover` on the enclosed `<img>` unambiguously resolve against `.zoom-inner`'s bounding box across all layout passes.

#### Scenario: Image box matches slot dimensions at rest

- **WHEN** the collage renders at baseline or after reverse scroll
- **THEN** each `.zoom-image` bounding box matches its parent `.zoom-inner` slot box
- **AND** `object-fit: cover` preserves each photo's natural aspect ratio without stretching or squashing
