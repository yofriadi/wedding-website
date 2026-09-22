## Purpose

Behavioral requirements for the remaining interactive UI motion — FAQ accordions, loading feedback, pressable controls, RSVP confirmation, and venue-map interactions — covering easing, timing, interruptibility, pointer gating, and reduced motion. The retired story viewer, rail, and add-story modal are not part of this capability; preservation of the existing magnetic trail and add-image feedback is specified by `guest-photo-trail`.

> Sync disposition: Replace the main spec's Purpose with the paragraph above; do not retain its retired story-viewer scope. The explicit scenario-removal note below guides the merge and is not requirement text to copy.

## MODIFIED Requirements

### Requirement: Press scales are transition-driven

Press feedback (`:active` scale), wherever present on current pressable controls, SHALL be paired with a transform transition of approximately 160ms ease-out rather than snapping while other properties animate. The retired add-story controls SHALL NOT be required to exist. The RSVP confirm button (StarButton) SHALL retain its existing `scale(0.97)` press behavior and reduced-motion behavior. The existing add-image control's motion is preserved by guest-photo-trail; this removal does not prescribe a new press effect for it.

> Sync disposition: Explicitly remove the superseded scenario **"Pressing the add-story flow's controls"**. The two scenarios below are the complete final scenario set for this requirement; the old Choose photos, Cancel, and Share controls must not survive as a scenario obligation.

#### Scenario: Current control has press-scale feedback

- **WHEN** a guest presses and releases a current control with an active-scale style
- **THEN** the scale eases in and back over approximately 160ms instead of snapping

#### Scenario: Pressing the RSVP confirm button

- **WHEN** the user presses and holds the StarButton CTA
- **THEN** the pill eases to `scale(0.97)` over approximately 160ms and eases back on release with rim rotation unaffected; under reduced motion the press applies instantly without a tween

## REMOVED Requirements

### Requirement: Interactive motion is confined to composite properties

**Reason**: This requirement specifically governs the retired story viewer's progress ticks and slide transitions, not the remaining site-wide motion.
**Migration**: Remove story progress/slide animation code; retain existing unrelated component motion and the current magnetic renderer without applying DOM slide rules to its canvas.

#### Scenario: Story progress loop is absent

- **WHEN** the memories section is active
- **THEN** no story progress interval or slide-transition runtime is created

### Requirement: Modal and panel transitions use ease-out in both directions

**Reason**: The referenced story viewer panel/backdrop no longer exists.
**Migration**: Remove story modal entrance/exit code and tests without altering unrelated component transitions.

#### Scenario: Photo presentation does not open a panel

- **WHEN** the trail presents guest photos
- **THEN** no story panel/backdrop entrance or exit is required

### Requirement: Story hand-off is event-driven, not timer-driven

**Reason**: There is no next/previous story-viewer chain to coordinate.
**Migration**: Remove story viewer hand-off events and fallback timers; preserve the independent trail sequence.

#### Scenario: Sequence uses the trail runtime

- **WHEN** the trail advances through its photo pool
- **THEN** it does not wait on incoming story-slide readiness or a story hand-off timeout

### Requirement: Story viewer honors reduced motion

**Reason**: The retired story viewer has no modal or slides to animate.
**Migration**: Remove its reduced-motion branch with the component; preserve reduced-motion behavior for the existing trail and unrelated components.

#### Scenario: Reduced-motion presentation has no story viewer

- **WHEN** a reduced-motion visitor views guest photos
- **THEN** the trail's reduced-motion presentation is used and no story viewer is mounted

### Requirement: Story cover hover motion is pointer-class gated

**Reason**: Story covers and runtime-built rail covers are no longer rendered.
**Migration**: Remove story-only hover styles when no remaining consumer uses them; retain pointer gating on unrelated controls.

#### Scenario: Trail has no story cover hover

- **WHEN** a pointer moves over the memories presentation
- **THEN** no retired story-cover hover rule or handler is required

### Requirement: Story viewer's first slide fades in

**Reason**: Story slides/spinners have been replaced by the existing trail image-loading path.
**Migration**: Remove story-specific reveal code and tests while preserving decode-aware trail refresh and upload success checks.

#### Scenario: New photo is decoded through the trail

- **WHEN** a new guest photo is loaded
- **THEN** it uses the trail's image preparation rather than a first-story-slide fade handler

### Requirement: Runtime-built tiles render with full SSR motion behavior

**Reason**: There are no dynamically constructed guest story tiles or SSR story tiles to keep in parity.
**Migration**: Remove guest-rail construction and story-only global animation selectors after checking shared consumers.

#### Scenario: Collection refresh creates no story tile

- **WHEN** guest photos are refreshed
- **THEN** the trail source pool updates without appending story tiles or attaching their spinners/fade-up animations
