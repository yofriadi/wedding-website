# welcome-gate Specification

## Purpose

A fixed welcome screen between the loading overlay and the hero: it shows the invitee's name (server-rendered) and a shimmer "swipe up" hint, scroll-locks the page, and reveals the hero through a finger-tracked upward swipe that also unlocks background music and fires the open metric. Desktop, reduced-motion, and no-JS visitors all retain a working path past it.

## Requirements

### Requirement: Gate surface and stacking

The homepage SHALL render a fixed, viewport-covering welcome gate in the initial HTML, stacked below the loading overlay and below any active entry claim gate, and above all page content. The gate surface SHALL follow the device color scheme (dark near-black / light white, Vercel-style monochrome) via CSS only, and SHALL include a background layer able to hold a designated image asset, with a themed dot-pattern fallback when no asset is present. While `#claim-gate` is active, `#welcome-gate` SHALL be marked `aria-hidden="true"` so assistive technology focuses exclusively on the claim input. For visits presenting an eligible unclaimed group invitation, the welcome gate's reveal, scroll re-pin (`window.scrollTo(0, 0)`), and gesture arming SHALL occur following the dismissal or hiding of the entry claim gate. `WelcomeGate`'s script SHALL check for `#claim-gate` presence and pause its auto-dismiss failsafe animation so open-ended guest typing cannot cause the welcome gate to prematurely dismiss; dismissing `#claim-gate` SHALL arm gestures and resume/restart the welcome gate failsafe if arming does not complete. For all other visits, the welcome gate SHALL be revealed directly when the loading overlay finishes and fades out.

#### Scenario: Gate ships in initial HTML

- **WHEN** the homepage HTML is delivered
- **THEN** the gate markup is present in the response (not client-injected), beneath the loading overlay

#### Scenario: Loader fade reveals the gate for standard visits

- **WHEN** the loading overlay finishes and fades out on a visit without an active claim gate
- **THEN** the welcome gate is what appears — a themed surface (never the hero)

#### Scenario: Claim gate dismissal reveals the gate for group visits

- **WHEN** the entry claim gate finishes and fades out upon member slot claim
- **THEN** the welcome gate is revealed underneath, re-pins scroll to zero, and is armed for swipe-to-open

#### Scenario: Claim gate held past standard failsafe delay remains visible

- **WHEN** a visitor remains on the entry claim gate for longer than 25 seconds with working scripts
- **THEN** the welcome gate failsafe does not trigger in the background and the welcome gate remains visible when the claim gate exits

#### Scenario: Background falls back gracefully

- **WHEN** no gate background image asset is available
- **THEN** the gate renders its themed dot-pattern fallback surface with no broken-image artifact

### Requirement: Gate content layout

The gate SHALL vertically center the greeting element and SHALL pin a shimmer-animated "swipe up" hint near the bottom edge. The hint reuses the same shimmer treatment as the loading phrases. No other content is required; the couple's names and date live on the hero behind the gate. When revealed directly from the server, the greeting element SHALL display the server-rendered display name (or empty for anonymous visitors). When revealed following a successful entry claim gate completion, the greeting element SHALL be dynamically populated with the newly claimed member's display name without requiring a page reload.

#### Scenario: Invited layout

- **WHEN** the gate is visible for an invited individual or already-claimed member
- **THEN** their name is centered and the shimmer hint sits near the bottom

#### Scenario: Dynamic greeting after claim

- **WHEN** the gate is revealed following a successful claim at the entry claim gate
- **THEN** the greeting element dynamically displays the newly claimed member's name and the shimmer hint sits near the bottom

#### Scenario: Anonymous layout

- **WHEN** the gate is visible for an anonymous visitor
- **THEN** the center greeting renders empty and only the shimmer hint is shown — no placeholder copy

### Requirement: Scroll locked while armed

The homepage scroll lock SHALL begin when the gate's inline script first runs (during initial HTML parse, while the loading overlay may still be up) and SHALL hold — through loading and arming — until reveal commit. While the lock is active, the page behind the gate SHALL NOT scroll, zoom, or rubber-band, and the hero SHALL remain at its scroll-zero (initial, fully zoomed) state. The lock SHALL release only as part of the gate's exit (reveal commit or a dismissal path).

Rationale for the widened window: the loading overlay gates on entry media — the HeroZoom-through-ZoomParallax sequence where the collage is scrubbed, first-view media only where it is collapsed — and can outlive DOMContentLoaded on a slow network, while the gate arms only after the overlay is removed. Without a lock that starts at first script run, a window exists between page parse and gate arming in which the raw page behind the overlay scrolls — the mid-timeline landing this requirement exists to prevent. Gesture binding, inert, and the failsafe cancel remain arm-time behaviors; only the scroll lock moves earlier.

#### Scenario: Scroll attempts do nothing

- **WHEN** the user swipes or wheels while the gate is armed
- **THEN** the document scroll position stays at 0 until the reveal commits

#### Scenario: The hero holds its initial state through the reveal

- **WHEN** the gate is armed and then dismissed at scroll zero
- **THEN** the hero stays fully zoomed in (its scroll-zero state) on every frame before, during, and after the gate's exit — the scroll lock never deactivates the hero's scroll-driven timeline, so its fully-revealed end state is never briefly shown

#### Scenario: The lock covers the loading overlay phase

- **WHEN** the loading overlay is still visible — including on a slow network where the overlay outlives DOMContentLoaded because it gates on media fetches
- **THEN** the document scroll position is 0 and the root scroll lock is already active — no window exists between page parse and gate arming in which the page behind the overlay scrolls

#### Scenario: The lock releases with the gate

- **WHEN** the gate exits by reveal commit or any dismissal path (reduced-motion tap, Escape, desktop wheel/click/keydown)
- **THEN** the scroll lock is released as part of that exit, and the page behind scrolls normally from scroll zero

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

The reveal commit SHALL invoke audio playback synchronously within the releasing touch gesture's activation window, so mobile autoplay policy permits it, but only on a `full` media tier (see the `media-tiering` capability). On a `lite` tier the commit SHALL neither start nor download the soundtrack and SHALL NOT arm any gesture fallback that would download it later. The gate SHALL hide its music note while the tier is `lite`, so no playback is promised on a lite connection. Where autoplay already succeeded (or the desktop dismissal had no activation), existing playback fallback behavior applies unchanged on the full tier.

#### Scenario: First swipe starts the music on a full tier

- **WHEN** a mobile guest on a full tier commits the reveal swipe and autoplay was previously blocked
- **THEN** background music begins playing without any further interaction

#### Scenario: Lite commit is silent and byte-free

- **WHEN** a mobile guest on a lite tier commits the reveal swipe
- **THEN** no soundtrack request is issued, no music plays, and no later gesture triggers a soundtrack download

#### Scenario: Lite gate makes no music promise

- **WHEN** the gate renders on a lite tier
- **THEN** the "music will play upon opening" note is not visible

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

If the gesture script throws or fails to load, a CSS failsafe SHALL auto-dismiss the gate after a bounded delay unless the gesture script has cancelled it by arming successfully. For visits with an entry claim gate where the claim script does not initialize, the welcome gate failsafe timer SHALL run from the moment the claim gate's CSS failsafe ends, ensuring that an unscripted exit never leaves the page trapped. When the user has disabled scripting, a `<noscript>` style rule and an `@media (scripting: none)` block SHALL hide the gate unconditionally.

#### Scenario: Failsafe triggers on gesture script failure

- **WHEN** the gesture script throws before arming
- **THEN** the gate fades out and becomes non-interactive after the failsafe delay

#### Scenario: Failsafe restarts on claim gate dismissal

- **WHEN** the entry claim gate dismisses but the welcome gate gesture script fails to arm
- **THEN** the welcome gate auto-dismiss failsafe triggers after its delay measured from claim gate exit

#### Scenario: No-script visitor sees no gate

- **WHEN** a visitor loads the homepage with JavaScript disabled
- **THEN** the welcome gate is not displayed and page content is immediately accessible

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
