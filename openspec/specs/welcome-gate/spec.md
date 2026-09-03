# welcome-gate Specification

## Purpose

A fixed welcome screen between the loading overlay and the hero: it shows the invitee's name (server-rendered) and a shimmer "swipe up" hint, scroll-locks the page, and reveals the hero through a finger-tracked upward swipe that also unlocks background music and fires the open metric. Desktop, reduced-motion, and no-JS visitors all retain a working path past it.

## Requirements

### Requirement: Gate surface and stacking

The homepage SHALL render a fixed, viewport-covering welcome gate in the initial HTML, stacked below the loading overlay and above all page content. The gate surface SHALL follow the device color scheme (dark near-black / light white, Vercel-style monochrome) via CSS only, and SHALL include a background layer able to hold a designated image asset, with a themed dot-pattern fallback when no asset is present.

#### Scenario: Gate ships in initial HTML

- **WHEN** the homepage HTML is delivered
- **THEN** the gate markup is present in the response (not client-injected), beneath the loading overlay

#### Scenario: Loader fade reveals the gate

- **WHEN** the loading overlay finishes and fades out
- **THEN** the welcome gate is what appears — a themed surface (never the hero)

#### Scenario: Background falls back gracefully

- **WHEN** no gate background image asset is available
- **THEN** the gate renders its themed dot-pattern fallback surface with no broken-image artifact

### Requirement: Gate content layout

The gate SHALL vertically center the greeting element and SHALL pin a shimmer-animated "swipe up" hint near the bottom edge. The hint reuses the same shimmer treatment as the loading phrases. No other content is required; the couple's names and date live on the hero behind the gate.

#### Scenario: Invited layout

- **WHEN** the gate is visible for an invited guest
- **THEN** their name is centered and the shimmer hint sits near the bottom

#### Scenario: Anonymous layout

- **WHEN** the gate is visible for an anonymous visitor
- **THEN** the center greeting renders empty and only the shimmer hint is shown — no placeholder copy

### Requirement: Scroll locked while armed

While the gate is armed, the page behind it SHALL NOT scroll, zoom, or rubber-band, and the hero SHALL remain at its scroll-zero (initial, fully zoomed) state.

#### Scenario: Scroll attempts do nothing

- **WHEN** the user swipes or wheels while the gate is armed
- **THEN** the document scroll position stays at 0 until the reveal commits

#### Scenario: The hero holds its initial state through the reveal

- **WHEN** the gate is armed and then dismissed at scroll zero
- **THEN** the hero stays fully zoomed in (its scroll-zero state) on every frame before, during, and after the gate's exit — the scroll lock never deactivates the hero's scroll-driven timeline, so its fully-revealed end state is never briefly shown

### Requirement: Finger-tracked upward swipe reveal

On touch devices, dragging upward SHALL move the gate 1:1 with the finger (transform-only). Downward drag SHALL be clamped (the gate does not travel down). On release, the gesture SHALL commit when the gate has traveled past a viewport-relative threshold or the finger has upward flick velocity; a committed gate animates fully off the top edge; an aborted gate springs back to rest. Both non-tracking transitions — the commit sweep and the spring-back — SHALL use the iOS-like drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` (not bare `ease-out`), keeping the existing durations (~400ms commit, ~250ms snap-back).

#### Scenario: Commit by distance

- **WHEN** the user drags the gate upward past the commit threshold and releases
- **THEN** the gate animates off-screen over ~400ms along the drawer curve and the reveal completes

#### Scenario: Commit by flick

- **WHEN** the user releases a short but fast upward swipe
- **THEN** the reveal commits even though the distance threshold was not reached

#### Scenario: Abort springs back

- **WHEN** the user drags upward slightly and releases without threshold or velocity
- **THEN** the gate springs back over ~250ms along the drawer curve to fully covering the viewport and remains armed

#### Scenario: No downward travel

- **WHEN** the user drags downward on the gate
- **THEN** the gate does not move downward with the finger

### Requirement: Reveal commit choreography

On reveal commit the gate SHALL animate away (transform-only), the scroll lock SHALL release, the gate element SHALL be removed from the DOM after its exit completes, and the hero scroll sequence SHALL then behave exactly as it does today from scroll zero.

#### Scenario: Clean handoff

- **WHEN** the reveal commits
- **THEN** the gate exits, scrolling unlocks, and subsequent scrolling drives the hero zoom from its initial state

### Requirement: Music unlocks on the reveal gesture

The reveal commit SHALL invoke audio playback synchronously within the releasing touch gesture's activation window, so mobile autoplay policy permits it. Where autoplay already succeeded (or the desktop dismissal had no activation), existing playback fallback behavior applies unchanged.

#### Scenario: First swipe starts the music

- **WHEN** a mobile guest commits the reveal swipe and autoplay was previously blocked
- **THEN** background music begins playing without any further interaction

### Requirement: Non-touch dismissal

Desktop-style input SHALL also commit the reveal: wheel scroll, click, or keydown while the gate is armed dismisses it (no finger-tracking physics required).

#### Scenario: Wheel dismisses

- **WHEN** a desktop user scrolls with a wheel or trackpad while the gate is armed
- **THEN** the gate dismisses and the page scrolls normally afterwards

### Requirement: Reduced-motion path

Under `prefers-reduced-motion: reduce` the gate SHALL NOT finger-track or slide; the first qualifying tap, click, or key press SHALL dismiss it without motion (fade or instant removal). The scroll lock still applies until dismissal.

#### Scenario: Reduced-motion tap

- **WHEN** a reduced-motion user taps the gate
- **THEN** the gate disappears immediately with no slide animation

### Requirement: The gate never traps the page

With scripting disabled, the gate SHALL NOT render (via the `scripting` media query). With scripting enabled, a CSS failsafe SHALL auto-dismiss the gate after a bounded delay unless the gesture script has cancelled it by arming successfully.

#### Scenario: No JavaScript

- **WHEN** the page loads with JavaScript disabled
- **THEN** no gate is shown and the homepage is usable

#### Scenario: Script failure safety net

- **WHEN** JavaScript is enabled but the gate script never arms
- **THEN** the gate auto-dismisses after the failsafe delay and the page becomes usable

### Requirement: Open metric trigger

On reveal commit, if the `ww_invite_id` cookie is present, the client SHALL fire exactly one best-effort `POST /api/invite/opened` (see `invite-open-tracking`) without awaiting it; the reveal SHALL NOT be delayed or failed by this request. Anonymous visitors SHALL NOT send the request.

#### Scenario: Invited reveal fires once

- **WHEN** an invited guest commits the reveal
- **THEN** exactly one `POST /api/invite/opened` is issued for that pageview, fire-and-forget

#### Scenario: Anonymous reveal stays quiet

- **WHEN** an anonymous visitor commits the reveal
- **THEN** no request is made to `/api/invite/opened`

#### Scenario: Metric failure is invisible

- **WHEN** the metric request fails or never returns
- **THEN** the reveal and subsequent browsing are unaffected
