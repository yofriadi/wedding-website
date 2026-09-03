# interaction-motion Spec Delta

## MODIFIED Requirements

### Requirement: Story cover hover motion is pointer-class gated

The story cover's hover scale-up SHALL apply only on devices with hover-capable, fine pointers, so touch taps never trigger a false hover grow. The rule SHALL be reachable by every tile — including tiles built at runtime with DOM APIs (guest tiles), which never carry the Astro scoping attribute — so the cover-zoom transition and its hover gate SHALL live in global (non-scoped) style scope.

#### Scenario: Touch device taps a story cover

- **WHEN** a touch-primary device (no `hover`/`pointer: fine`) taps any story cover (SSR or runtime-built)
- **THEN** no scale transform is applied to the cover image as a result of the tap

#### Scenario: Desktop hovers a story cover

- **WHEN** a hover-capable, fine-pointer device hovers any story cover (SSR or runtime-built)
- **THEN** the cover image scales up over the shared 200ms house-curve transition, identically for SSR and runtime-built tiles

## ADDED Requirements

### Requirement: Story viewer's first slide fades in

When a slide's image finishes loading, the slide SHALL become visible through a short opacity fade (≤200ms) rather than an instantaneous class flip, so a cold-loading first slide never hard-cuts over the spinner. The fade is opacity-only and therefore applies unchanged under reduced motion.

#### Scenario: First slide loads on a slow network

- **WHEN** a story viewer opens and its first slide image finishes decoding
- **THEN** the slide fades from 0 to 1 opacity over ~150ms as the spinner hides — no single-frame hard cut

#### Scenario: Re-opened slide from cache

- **WHEN** a viewer re-opens with the slide image already cached
- **THEN** the reveal is the same opacity fade (imperceptible when instant) and never a flash

### Requirement: Runtime-built tiles render with full SSR motion behavior

Tiles built at runtime with DOM APIs (guest tiles appended by the rail script) SHALL exhibit the same motion behavior as server-rendered tiles: the fade-up entrance, the rotating/dashing loading spinner, and the pointer-gated cover zoom. Style rules these runtime nodes depend on SHALL be reachable without Astro scoping attributes (global scope), since runtime nodes never carry them.

#### Scenario: A guest's story lands in the rail

- **WHEN** a newly posted (or initially fetched) guest tile is appended to the story rail
- **THEN** it enters with the same fade-up animation as SSR tiles (opacity + 20px rise over ~600ms, without a stagger delay)

#### Scenario: Guest tile spinner on a slow load

- **WHEN** a runtime-built guest viewer shows its loading spinner
- **THEN** the spinner rotates and dashes exactly like an SSR tile's spinner

### Requirement: FAQ honors reduced motion

When the user prefers reduced motion, FAQ open/close SHALL keep color and opacity feedback but drop movement: content fades (opacity-only) with height applied instantly, the badge fill changes without the scale pop, and the plus icon and active underline switch state without rotation or scale animation.

#### Scenario: Reduced-motion user expands a FAQ item

- **WHEN** `prefers-reduced-motion: reduce` is active and the user expands an item
- **THEN** the answer fades in within ~150ms already at full height, the badge background tweens color only, and the icon/underline states apply instantly

#### Scenario: Motion-permitted user expands a FAQ item

- **WHEN** reduced motion is not requested
- **THEN** the existing badge pop, spring icon rotation, spring underline, and height tween run unchanged

### Requirement: Press scales are transition-driven

Press feedback (`:active` scale) SHALL always be paired with a transform transition (~160ms ease-out) so the press eases in and back instead of snapping. This applies to every pressable control, including the add-story flow's controls and the RSVP confirm button (StarButton), which SHALL press to `scale(0.97)` like every other button.

#### Scenario: Pressing the add-story flow's controls

- **WHEN** the user presses and releases "Choose photos", Cancel, or Share
- **THEN** the control eases to its active scale and back over ~160ms — the transform never snaps while color/opacity transitions run

#### Scenario: Pressing the RSVP confirm button

- **WHEN** the user presses and holds the StarButton CTA
- **THEN** the pill eases to `scale(0.97)` over ~160ms and eases back on release, with the rim rotation unaffected; under reduced motion the press applies instantly (no tween)

### Requirement: Wish marquee is pausable in its real state and smooths state changes

When the marquee renders real wishes (`data-state="real"`, readable content at raised opacity), hovering or keyboard-focusing the band SHALL pause all rows so a guest can read a wish; the demo/empty texture states (non-interactive) SHALL NOT pause. Band opacity changes between states SHALL cross-fade (~300ms) instead of popping, and rebuilt rows SHALL resume from their live scroll offset rather than restarting at their phase offsets.

#### Scenario: Reading a real wish

- **WHEN** the marquee shows real wishes and the user hovers or focuses within the band
- **THEN** every row freezes mid-scroll (animation-play-state, preserving position) and resumes seamlessly when the pointer leaves

#### Scenario: Demo texture never pauses

- **WHEN** the marquee is in the demo or empty state
- **THEN** hover does not pause the scroll

#### Scenario: Data swap or resize during scroll

- **WHEN** rows are rebuilt (new submission or debounced resize) while the marquee is scrolling
- **THEN** each row continues from its current pixel offset instead of jumping back to its phase offset; first load still starts at the staggered phases

### Requirement: Venue map vendor animations honor reduced motion

Leaflet's own zoom animation (zoom-control clicks, double-click zoom) SHALL be disabled for reduced-motion users — via the library's `zoomAnimation` option at map construction and a CSS override of the vendor's `.leaflet-zoom-animated` transition — so no map motion reaches reduced-motion users beyond the already-gated `setView`/`fitBounds` calls.

#### Scenario: Reduced-motion user zooms the map

- **WHEN** `prefers-reduced-motion: reduce` is active and the user clicks the zoom controls or double-clicks the map
- **THEN** the zoom applies instantly with no vendor tween

### Requirement: Venue map hover lifts are pointer-class gated

Hover transforms on map controls (route chips, zoom links) SHALL apply only under `@media (hover: hover) and (pointer: fine)` so touch taps never leave a sticky lift; color-only hover feedback MAY remain ungated. The zoom controls SHALL be included in the component's reduced-motion `transition: none` set.

#### Scenario: Touch device taps a route chip

- **WHEN** a touch-primary device taps a route chip or zoom link
- **THEN** the selection/press applies with no hover lift transform sticking after the tap

### Requirement: RSVP confirm celebrates the state change

On a successful RSVP submission, the confirm button SHALL mark the state transition with motion: the label crossfades (outgoing fades/rises ~150ms, incoming fades/rises ~200ms with the house ease-out) and the pill plays a gentle settle-pop (`scale 1 → 1.04 → 1`, ≤300ms). The submission SHALL be marked confirmed and aria-disabled before the animation begins (no double-submit window); under reduced motion the label swaps instantly with no pop.

#### Scenario: Successful RSVP

- **WHEN** the RSVP POST succeeds
- **THEN** "Confirm Reservation" lifts and fades, "Reservation Confirmed" rises in, and the pill settles with one gentle pop — and the button rejects further submits from the moment the animation starts

#### Scenario: Reduced-motion RSVP

- **WHEN** the RSVP POST succeeds under `prefers-reduced-motion: reduce`
- **THEN** the label and disabled state apply instantly, identical to the pre-animation behavior

### Requirement: Route polylines draw in from their origin

When a transit origin is selected, its route polyline SHALL draw in from the origin pin toward the venue (~500ms, strong ease-out) alongside the fitBounds pan, instead of appearing fully formed — the line's direction of growth explains which two points it connects. Under reduced motion the path renders complete.

#### Scenario: Selecting a route

- **WHEN** the user selects a transit origin chip or marker
- **THEN** the glow and core strokes grow from the origin toward the venue over ~0.5s as the map pans, and rapid re-selection never leaves a frozen mid-draw path

#### Scenario: Dashed connector survives the draw

- **WHEN** the airport route (with its dashed first chord) finishes drawing in
- **THEN** the first chord renders dashed again after the animation completes

### Requirement: Map placeholder crossfades into the live map

When the lazily mounted map finishes initializing, the placeholder SHALL crossfade out (~250ms, opacity-only) as the map fades in, rather than vanishing in a same-frame swap. The import-failure fallback and the reduced-motion path SHALL remain instant.

#### Scenario: Map mounts on scroll

- **WHEN** the venue section nears the viewport and Leaflet finishes mounting
- **THEN** the placeholder dims out over ~250ms while the map fades in beneath it, with no flash and no pointer-events dead zone after the swap
