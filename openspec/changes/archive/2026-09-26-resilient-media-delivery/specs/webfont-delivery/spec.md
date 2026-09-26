## ADDED Requirements

### Requirement: One font family per typographic role

The site SHALL load at most one family per typographic role — one sans and one serif — resolved through the `--font-sans` and `--font-serif` theme tokens. A static-instance family SHALL NOT be loaded alongside the variable family that supersedes it in the same token stack. Variation axes SHALL be limited to those a consumer actually drives. Character subsets SHALL be gated so that a subset with no consumer transfers no bytes during a pageview; because the stock `@fontsource` entrypoints emit a `unicode-range`-gated `@font-face` for every subset they cover, this requirement is satisfied by the range gate rather than by omitting declarations, and SHALL be verified against the request list rather than the emitted CSS. The serif italic axis is retained: `HeroZoom` renders the display ampersand in it and `RsvpSection` renders an italic line.

#### Scenario: No redundant sans family

- **WHEN** the production build is inspected
- **THEN** only the family that `--font-sans` resolves to first is fetched, and the superseded static family emits no request

#### Scenario: Unused variation axes are dropped

- **WHEN** the serif is loaded from a variable-font entrypoint
- **THEN** axes no consumer drives — SOFT and WONK on Fraunces — are absent from the fetched files, while the optical-size axis, which `font-optical-sizing: auto` relies on at display sizes, is retained

#### Scenario: Unused subsets are dropped

- **WHEN** the page renders Indonesian and English text only
- **THEN** no Vietnamese or Cyrillic subset file is requested

### Requirement: Font payload budget

For a render that uses only `latin` characters, the total font payload transferred on a first load SHALL NOT exceed 200 KB, measured as the sum of font bytes actually fetched on a 390 CSS px viewport with an empty cache. A render that triggers a `latin-ext` range MAY add those files on top; no other subset SHALL be requested on any render. Variable axes SHALL be limited to the weights and optical sizes in use. Legacy formats SHALL NOT be emitted for engines that support `woff2`.

#### Scenario: First load stays inside budget

- **WHEN** a guest loads the page for the first time with an empty cache on a 390 CSS px viewport
- **THEN** the sum of all font bytes transferred is at or below 200 KB

#### Scenario: No legacy woff is requested

- **WHEN** a modern browser loads the page
- **THEN** no `.woff` (non-`woff2`) file is requested

#### Scenario: Subsets match rendered text

- **WHEN** the font files are inspected
- **THEN** no subset is loaded for a character range the site never renders

### Requirement: The critical font file is preloaded

The `woff2` file carrying the serif face that paints the largest above-the-fold display text for the `latin` subset SHALL be declared with a `rel="preload"` hint in the document head with `as="font"` and `crossorigin`, so it is discovered during head parsing rather than after the stylesheet is fetched and applied. The hint SHALL reference the bundled, content-hashed URL the build actually serves — resolved through the bundler rather than written as a package path — so it cannot 404 or double-fetch. At most two font files SHALL be preloaded.

#### Scenario: Critical font discovered in head

- **WHEN** the document head is parsed on a throttled link
- **THEN** the preloaded latin serif `woff2` request is issued before the body renders

#### Scenario: Preload is not used as a bulk loader

- **WHEN** the delivered document head is inspected
- **THEN** no more than two `rel="preload"` font hints are present

### Requirement: Text renders before fonts arrive

Font faces SHALL declare `font-display: swap`, and no text SHALL be invisible while a font file downloads. Fallback metric matching (`size-adjust`, `ascent-override`) is deliberately **not** required: the token stacks resolve to generic `sans-serif`/`serif` once the dead family names are dropped, and adding metric-override faces would be new machinery the objective does not need. Reflow on swap is accepted.

#### Scenario: Text is legible during font download

- **WHEN** the page renders on a throttled link while font files are still in flight
- **THEN** all text is visible in a fallback face
