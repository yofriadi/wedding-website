## ADDED Requirements

### Requirement: Delivered markup is complete without JavaScript

The document the server delivers SHALL present its full textual content and a visible representation of every media position with JavaScript disabled or not yet executed. No content region SHALL depend on a script running to become present in the render tree. Every layer that covers the viewport and is dismissed by script — the loading screen and the welcome gate among them — SHALL be suppressed without script by the idiom already used elsewhere in the repository (a `<noscript>` style override, with an `@media (scripting: none)` twin), so an engine that never runs the script is never left behind an overlay. Suppression is the requirement, not inversion: these layers are legitimately rendered in delivered markup and _removed_ by script for the scripted experience, so they SHALL NOT be required to ship hidden.

#### Scenario: Text survives a script blocker

- **WHEN** the page is loaded with JavaScript disabled
- **THEN** every heading, paragraph, and label the site intends to show is visible

#### Scenario: Every media position shows something

- **WHEN** the page is loaded with JavaScript disabled
- **THEN** no image element is without a fetchable source, and no media position renders as an empty box

#### Scenario: An overlay never traps a no-script guest

- **WHEN** the page is loaded with JavaScript disabled and a full-viewport overlay is present in markup
- **THEN** the overlay is not rendered and the content beneath it is reachable, including the loading screen, which is dismissed only by script

### Requirement: Scroll-driven reveals never hide unanimated content

Content that participates in a scroll-driven fade or slide SHALL be delivered at full opacity in markup and in the initial computed style. The reveal SHALL be applied as an overlay by script once it is running, and SHALL only reduce opacity for content the script has itself measured as outside its reveal window. A state in which script has not yet run, has run late, or has failed SHALL leave content visible, not invisible.

#### Scenario: Content is visible before the reveal script runs

- **WHEN** the document has parsed and rendered but the reveal script has not executed
- **THEN** every reveal participant is at opacity 1

#### Scenario: Late script does not blank the page

- **WHEN** the reveal script first executes on a throttled link after the guest can already see the page
- **THEN** content that has fully entered — `rect.top <= viewportHeight - enterThreshold`, the boundary `computeFrame` actually uses — remains at opacity 1, and only content measured outside it is set to its pre-reveal state. A partially entered element inside the bottom `enterThreshold` band is exempt and may compute below 1

#### Scenario: Script failure leaves content readable

- **WHEN** the reveal script never loads, or throws at any point — at init, in the read pass, or mid-write pass
- **THEN** no reveal participant inside the viewport sits below the opacity the delivered markup gave it. Participants the script had already measured as outside the reveal window may remain at their pre-reveal opacity, which is indistinguishable from normal operation and is what the requirement above permits

#### Scenario: Reduced motion is unchanged

- **WHEN** a guest prefers reduced motion
- **THEN** reveal participants are at opacity 1 with no transform, as the existing behavior requires

### Requirement: Deferred upgrades have a visible predecessor state

Any media whose full-quality bytes are withheld **by tier** SHALL occupy its final box with a visible low-fidelity representation until the full bytes arrive. Withholding quality SHALL be expressed as a reduction in resolution, never as the absence of a source. Each placeholder SHALL NOT exceed 4 KB, and the generation step SHALL fail when one does, so the aggregate placeholder cost of a tier cannot grow silently. Browser-native laziness is deliberately outside this requirement: a `loading="lazy"` image ships its real `src` and reserves its box through intrinsic dimensions, so the browser paints it on approach without a placeholder layer.

#### Scenario: Withheld quality still shows an image

- **WHEN** the connection is slow enough that full-resolution media is withheld
- **THEN** the media position displays its low-fidelity placeholder at the correct aspect ratio

#### Scenario: Placeholder is affordable on the slow link

- **WHEN** a placeholder is delivered on a Good-3G-class link
- **THEN** it arrives and paints without competing with the page's critical path

#### Scenario: Upgrade replaces rather than fills

- **WHEN** the full-quality bytes become available
- **THEN** the placeholder is replaced in the same box with no layout change
