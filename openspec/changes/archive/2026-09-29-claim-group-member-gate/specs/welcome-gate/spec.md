# welcome-gate Specification (delta)

## MODIFIED Requirements

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

- **WHEN** a visitor remains on the entry claim gate for longer than 15 seconds with working scripts
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
