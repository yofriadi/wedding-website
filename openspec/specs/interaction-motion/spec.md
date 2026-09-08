# interaction-motion Specification

## Purpose

Behavioral requirements for the interactive UI motion layer — story viewer (modal, slides, progress), FAQ accordion, loading screen — covering easing/duration contracts, physicality, interruptibility, composite-only properties, hover gating, and reduced-motion behavior.

## Requirements

### Requirement: Interactive motion is confined to composite properties

The story viewer's progress indication and slide transitions SHALL animate only `transform` and `opacity` (composite properties), and SHALL NOT write layout-triggering properties (`width`, `height`, `top`, `left`) on any per-frame code path.

#### Scenario: Progress bar ticks

- **WHEN** a story is playing and the 50ms progress interval fires
- **THEN** the active segment's fill advances via `transform: scaleX()` from a `transform-origin: left`, and no `style.width` write occurs on any progress element

#### Scenario: Inactive segments are not rewritten per tick

- **WHEN** the active story index changes
- **THEN** past segments are set to `scaleX(1)` and future segments to `scaleX(0)` exactly once per index change, and subsequent progress ticks write only the active segment

#### Scenario: Slide transition

- **WHEN** the user advances to the next or previous story
- **THEN** both slides animate a full `transform: translateX()` keyframe pair (not an independent `x`/`y` shorthand), and the panel entrance/exit composes `translateY` and `scale` into a single transform

### Requirement: Modal and panel transitions use ease-out in both directions

Story viewer entrances and exits SHALL use the house ease-out curve in both directions; exits SHALL be faster than entrances (asymmetric timing), because an exit confirms an action the user already took.

#### Scenario: Closing the story viewer

- **WHEN** the user closes the modal (close button, Escape, or end-of-stories)
- **THEN** the panel exit animates with `cubic-bezier(0.16, 1, 0.3, 1)` over 150ms — never an ease-in curve — and the backdrop opacity fade completes in 200ms

#### Scenario: Opening the story viewer

- **WHEN** the user opens a story viewer
- **THEN** the panel entrance uses `cubic-bezier(0.16, 1, 0.3, 1)` over 300ms (unchanged from current behavior)

### Requirement: Story hand-off is event-driven, not timer-driven

When one story viewer finishes and hands off to the next (or previous) viewer, the closing of the outgoing viewer SHALL be driven by the incoming viewer's first slide becoming ready — not by a fixed timeout.

#### Scenario: Next viewer's image decodes slowly

- **WHEN** a viewer's last story ends, the next viewer opens, and its first slide image takes longer than the slide-in duration to load
- **THEN** the outgoing viewer remains open (not closing on a timer) and is closed via the existing non-animated close path only after the incoming viewer's first slide is ready, so no black flash appears between viewers

#### Scenario: Ready signal never arrives

- **WHEN** the incoming viewer's first slide fails to signal readiness within 800ms
- **THEN** a fallback timeout closes the outgoing viewer so the hand-off can never deadlock

### Requirement: Story viewer honors reduced motion

When the user prefers reduced motion, the story viewer SHALL keep opacity-based feedback and drop movement: modal backdrop and panel fade without `scale`/`translateY`, and slides cross-fade without `translateX` sliding.

#### Scenario: Reduced-motion user opens a story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user opens a story viewer
- **THEN** the panel appears via opacity fade only (no scale/y transform), and advancing stories cross-fades slides in place without horizontal sliding

#### Scenario: Motion-permitted user opens a story

- **WHEN** reduced motion is not requested
- **THEN** the panel entrance (scale + translateY) and slide transitions (translateX) run as specified for motion-permitted users

### Requirement: Story cover hover motion is pointer-class gated

The story cover's hover scale-up SHALL apply only on devices with hover-capable, fine pointers, so touch taps never trigger a false hover grow. The rule SHALL be reachable by every tile — including tiles built at runtime with DOM APIs (guest tiles), which never carry the Astro scoping attribute — so the cover-zoom transition and its hover gate SHALL live in global (non-scoped) style scope.

#### Scenario: Touch device taps a story cover

- **WHEN** a touch-primary device (no `hover`/`pointer: fine`) taps any story cover (SSR or runtime-built)
- **THEN** no scale transform is applied to the cover image as a result of the tap

#### Scenario: Desktop hovers a story cover

- **WHEN** a hover-capable, fine-pointer device hovers any story cover (SSR or runtime-built)
- **THEN** the cover image scales up over the shared 200ms house-curve transition, identically for SSR and runtime-built tiles

### Requirement: FAQ badge pops on open

When a FAQ accordion item opens, its number badge SHALL animate a subtle scale pop alongside the existing fill-color change, giving the state change physicality.

#### Scenario: Opening a FAQ item

- **WHEN** the user expands a FAQ item
- **THEN** the number badge scales 1 → 1.08 → 1 with the house ease-out curve (~300ms) while its background transitions to the active fill color

### Requirement: Loading phrases crossfade rather than cut

The loading screen's rotating phrases SHALL transition through a short blur-masked crossfade instead of replacing text instantly.

#### Scenario: Phrase rotation

- **WHEN** the loading phrase advances to the next in the list
- **THEN** the outgoing phrase fades and blurs out (≤2px blur) while the incoming phrase fades in, completing within ~150ms, with no frame showing an empty phrase slot

### Requirement: FAQ hover handlers do not animate to current values

The FAQ accordion SHALL NOT contain hover handlers that animate properties to the values those elements already hold (no-op animations).

#### Scenario: Hovering a FAQ item

- **WHEN** the pointer enters or leaves a FAQ item that is not active
- **THEN** no `animate()` call fires for the number badge background/scale on hover, and no visual change occurs beyond the button's existing utility-class transitions

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
