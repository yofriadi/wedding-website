# star-button Specification

## Purpose

The reusable themed confirm-button presentation: a pill whose rim is a conic gradient rotating continuously, so a light appears to circle the button, with an opaque interior plate and a flat label. The button is the inverse of the page in both themes: on a dark page a light pill, on a light page a dark pill. The interior carries no ornament (no starfield). The effect is pure CSS — no script, no measurement — and degrades to a static, readable button under reduced motion, without JavaScript, and without registered-custom-property support.

## Requirements

### Requirement: Rotating rim light

The button SHALL render its rim as a conic gradient whose angle rotates continuously, looping indefinitely with period `--star-btn-duration`. The rim SHALL be produced by the button root's own background gradient plus an opaque interior plate inset by `--star-btn-rim-width`, so the visible gradient is a band of exactly that width around the perimeter and never washes the interior. The gradient's two outer stops SHALL be the same color, so the band closes on itself without a seam. The rotation SHALL be a CSS animation of a registered custom property — no JavaScript, no box measurement, and no additional elements. The animation SHALL continue while the button is disabled, and the disabled state SHALL NOT dim the button.

#### Scenario: Rim rotates on a loop

- **WHEN** the button is visible
- **THEN** the rim's gradient angle advances continuously and repeats with the configured period

#### Scenario: Rim is a band, not a wash

- **WHEN** the button renders
- **THEN** an opaque plate inset by the rim width covers the interior, leaving the gradient visible only as a band around the perimeter, with the plate's corner radius concentric with the pill's

#### Scenario: No script and no measurement

- **WHEN** the component's rendered output is inspected
- **THEN** it carries no component script, and the effect survives at any button size without anything reading the box

#### Scenario: Animation runs while disabled

- **WHEN** the button is disabled
- **THEN** the rim keeps rotating at full opacity (the effect is presentational state, not affordance) and only the pointer cursor is dropped

### Requirement: Flat label above the plate

The label SHALL be rendered as plain text in the button's ink color, stacked above the interior plate, on a single line at every viewport width. The label text SHALL be the accessible name of the button, announced exactly once. The button's horizontal padding and font size SHALL scale with the viewport so that neither label overflows a 320px-wide screen, reaching their full values on wider viewports; the button SHALL NOT declare a content-derived minimum width that would defeat that cap.

#### Scenario: Label is the accessible name

- **WHEN** assistive technology announces the button
- **THEN** it reads the label text as a single accessible name — never doubled, never per-character

#### Scenario: Long label fits a small phone

- **WHEN** the longer (confirmed) label renders at a 320px viewport width
- **THEN** the button stays within the viewport with no horizontal overflow, the label stays on one line, and the pill keeps its height

### Requirement: Visible keyboard focus

The button SHALL show a focus indicator that is distinguishable from the rotating rim: an outline in the pill's surface color, offset outside the rim band, applied on keyboard focus only (`:focus-visible`) so a pointer press leaves no residual ring. Under forced colors, where an inset system outline already occupies the rim's position, the focus indicator SHALL be a system highlight color distinct from that outline.

#### Scenario: Keyboard focus is perceivable

- **WHEN** a visitor tabs to the button
- **THEN** an outline appears outside the rim band, in a color that contrasts with both the pill and the page — never only the rim itself

#### Scenario: Pointer press leaves no ring

- **WHEN** the button is clicked with a pointer
- **THEN** no focus outline remains on it

### Requirement: No starfield interior

The button interior SHALL NOT render the original StarButton starfield (the dot/star SVG background) or any other ornament. It SHALL be one flat opaque fill in the button's own surface color, in both themes; the button's visual identity is the rotating rim and the label.

#### Scenario: Interior carries no ornament

- **WHEN** the button renders on the RSVP section background
- **THEN** no star/dot pattern is present inside the button — the interior is one flat fill in the button's surface color, and the section background is not visible through it in either theme

### Requirement: Themed dark baseline and light inversion

The component SHALL define its colors as custom properties on the button root, reduced to two polarity tokens — `--star-btn-surface` (the interior plate and the rim's sweep) and `--star-btn-ink` (the label and the rim's base, which is the page's own ground) — with the dark-page presentation as fallback (`--star-btn-surface: #fafafa`, `--star-btn-ink: #0a0a0a`). Every other color SHALL be one of those two rather than authored per theme. Under `prefers-color-scheme: light` the component SHALL swap the two polarity tokens (`--star-btn-surface: #0a0a0a`, `--star-btn-ink: #fafafa`) and change nothing else, so the two themes are each other's mirror by construction. Theming SHALL follow device preference only — no toggle and no stored preference — using the repo's custom-property + media-query pattern (dark-page values as fallback, light overrides in a `prefers-color-scheme: light` block).

#### Scenario: Dark page gets the light pill

- **WHEN** the device prefers dark (or declares no preference)
- **THEN** the button is a near-white pill with a near-black label, and its rim sweeps near-white over a near-black base — the opposite of the page, not a match for it

#### Scenario: Light page flips the polarity

- **WHEN** the device prefers light
- **THEN** the button is a near-black pill with a near-white label and a near-black sweep, with contrast equivalent to the dark-page presentation

#### Scenario: No color is authored twice

- **WHEN** the component's painted colors are resolved in either theme
- **THEN** each one equals one of the two polarity tokens — a color hard-coded to suit one theme is a defect, because it cannot invert with the other

### Requirement: Static degradation

Under `prefers-reduced-motion: reduce`, without JavaScript, or without support for registering the gradient's angle as an animatable custom property, the button SHALL present statically: the rim band visible at a fixed angle and the label readable — never a missing rim, invisible text, or a broken animation state. Reduced motion SHALL take precedence over the disabled-animation rule: a disabled button under reduced motion is static. Under forced-colors mode, the rim SHALL be replaced by a system-color outline inset within the same box and the label rendered in system colors, leaving the button's size unchanged.

#### Scenario: Reduced motion is fully static

- **WHEN** a visitor prefers reduced motion
- **THEN** the button shows the rim band at a fixed angle with a readable label, and no animation runs

#### Scenario: Disabled plus reduced motion resolves to static

- **WHEN** a visitor prefers reduced motion and the button is disabled
- **THEN** the static presentation wins — no rotation, static rim and label

#### Scenario: No JavaScript still renders the button

- **WHEN** the page is viewed with JavaScript disabled
- **THEN** the button renders and animates unchanged — nothing about the presentation was ever script-driven

#### Scenario: Unregistered angle falls back

- **WHEN** the browser cannot register the gradient angle as a typed custom property
- **THEN** the rim renders at its initial angle (the static presentation) instead of a broken or jumping effect

#### Scenario: Forced colors keeps the button readable

- **WHEN** the browser runs in forced-colors mode
- **THEN** the rim becomes a system-color outline inset within the same box and the label plain system-color text, with no change to the button's height
