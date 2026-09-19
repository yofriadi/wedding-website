# interaction-motion Specification

## Purpose

Behavioral requirements for the remaining interactive UI motion — FAQ accordions, loading feedback, pressable controls, RSVP confirmation, and venue-map interactions — covering easing, timing, interruptibility, pointer gating, and reduced motion. The retired story viewer, rail, and add-story modal are not part of this capability; preservation of the existing magnetic trail and add-image feedback is specified by `guest-photo-trail`.

## Requirements

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

### Requirement: FAQ honors reduced motion

When the user prefers reduced motion, FAQ open/close SHALL keep color and opacity feedback but drop movement: content fades (opacity-only) with height applied instantly, the badge fill changes without the scale pop, and the plus icon and active underline switch state without rotation or scale animation.

#### Scenario: Reduced-motion user expands a FAQ item

- **WHEN** `prefers-reduced-motion: reduce` is active and the user expands an item
- **THEN** the answer fades in within ~150ms already at full height, the badge background tweens color only, and the icon/underline states apply instantly

#### Scenario: Motion-permitted user expands a FAQ item

- **WHEN** reduced motion is not requested
- **THEN** the existing badge pop, spring icon rotation, spring underline, and height tween run unchanged

### Requirement: Press scales are transition-driven

Press feedback (`:active` scale), wherever present on current pressable controls, SHALL be paired with a transform transition of approximately 160ms ease-out rather than snapping while other properties animate. The retired add-story controls SHALL NOT be required to exist. The RSVP confirm button (StarButton) SHALL retain its existing `scale(0.97)` press behavior and reduced-motion behavior. The existing add-image control's motion is preserved by guest-photo-trail; this removal does not prescribe a new press effect for it.

#### Scenario: Current control has press-scale feedback

- **WHEN** a guest presses and releases a current control with an active-scale style
- **THEN** the scale eases in and back over approximately 160ms instead of snapping

#### Scenario: Pressing the RSVP confirm button

- **WHEN** the user presses and holds the StarButton CTA
- **THEN** the pill eases to `scale(0.97)` over approximately 160ms and eases back on release with rim rotation unaffected; under reduced motion the press applies instantly without a tween

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
