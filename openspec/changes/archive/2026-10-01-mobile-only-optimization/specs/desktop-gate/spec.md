# desktop-gate Specification

## Purpose

Intercept desktop and tablet visitors on viewports $\ge 768\text{px}$ width and $\ge 600\text{px}$ height with an elegant mobile-only gateway displaying an in-process rendered SVG QR code encoding the visitor's personalized invitation URL (`/<id>`), while keeping background media inert and suppressing unnecessary audio and collage image downloads.

## ADDED Requirements

### Requirement: Desktop and tablet viewport interception

The homepage SHALL intercept visitors on viewports with width $\ge 768\text{px}$ and height $\ge 600\text{px}$ with a full-viewport blocking overlay (`DesktopGate`). Mobile devices in portrait (width $< 768\text{px}$) and mobile devices rotated to landscape (height $< 600\text{px}$) SHALL NOT be intercepted and SHALL render the normal mobile invitation. While `DesktopGate` is active, the document root SHALL be scroll-locked (`overflow: hidden`) so wheel input does not scroll the background page behind the overlay. When resized below the threshold, the scroll lock SHALL release immediately if `#welcome-gate` is absent, or hand off to `WelcomeGate` if connected.

#### Scenario: Desktop visitor sees gate overlay

- **WHEN** a visitor loads the homepage on a viewport $\ge 768\text{px}$ wide and $\ge 600\text{px}$ high
- **THEN** `DesktopGate` is displayed covering the viewport, showing the couple's monogram, a message prompting them to open the invitation on their phone, and a scannable QR code

#### Scenario: Mobile visitor experiences normal invitation

- **WHEN** a visitor loads the homepage on a mobile viewport ($< 768\text{px}$ wide)
- **THEN** `DesktopGate` is hidden (`display: none`), and the normal loading screen and mobile invitation flow proceed uninterrupted

#### Scenario: Landscape mobile phone is not blocked

- **WHEN** a visitor loads or rotates the homepage on a smartphone in landscape orientation (e.g., $844 \times 390\text{px}$ or $915 \times 412\text{px}$)
- **THEN** because the viewport height is $< 600\text{px}$, `DesktopGate` remains hidden

#### Scenario: Window resize dynamically toggles gate visibility and scroll lock

- **WHEN** a desktop browser window is resized across the $768\text{px} \times 600\text{px}$ threshold
- **THEN** the gate displays or hides dynamically via pure CSS media queries (`@media (min-width: 768px) and (min-height: 600px)`), and the document scroll lock applies on desktop and releases dynamically (or hands off to `WelcomeGate` if present)

### Requirement: In-process QR code encodes personalized invitation URL

`DesktopGate` SHALL display an in-process generated SVG QR code (rendered via `renderSVG` and inlined with `set:html`) and emit a `data-qr-target` attribute on its container exposing the encoded URL for verification. When the visitor holds an invite cookie (`ww_invite_id`), the QR code SHALL encode the visitor's full personalized invitation URL (`${origin}/${inviteId}`). When no invite cookie is present, the QR code SHALL encode the site origin (`${origin}/`).

The QR code SHALL be generated in-process without making requests to third-party QR generation APIs, ensuring private invite tokens are never leaked to external services.

#### Scenario: Invited guest scans QR code

- **WHEN** an invited guest opens `/<id>` on a desktop browser (which sets `ww_invite_id` and redirects to `/`)
- **THEN** `DesktopGate` displays a QR code encoding `${origin}/${inviteId}`
- **AND** scanning the QR code on a mobile device navigates to `/<id>`, binding their personalized invite identity on mobile

#### Scenario: Anonymous visitor scans QR code

- **WHEN** an unauthenticated visitor opens `/` on a desktop browser without an invite cookie
- **THEN** `DesktopGate` displays a QR code encoding the site root URL (`${origin}/`)

### Requirement: Accessibility and background containment

`DesktopGate` SHALL be accessible to assistive technologies. It SHALL declare `role="dialog"`, `aria-modal="true"`, and carry an `aria-labelledby` reference to its heading. When `DesktopGate` is active on viewports $\ge 768\text{px} \times \ge 600\text{px}$, background content in `<main>`, `#claim-gate`, and `#welcome-gate` SHALL be marked `inert` so background elements cannot be reached by tab navigation or screen reader exploration. When the viewport is resized below the threshold, `inert` SHALL be removed from `#claim-gate` and `#welcome-gate`; `<main>` SHALL retain `inert` while `#welcome-gate` is connected and active, and lose `inert` upon gate exit or if `#welcome-gate` is absent.

#### Scenario: Background content is inert behind gate

- **WHEN** `DesktopGate` is displayed on a desktop viewport
- **THEN** `<main>`, `#claim-gate`, and `#welcome-gate` are marked `inert`, preventing focus and pointer events on underlying content

#### Scenario: Resize below threshold removes inert from gates and hands off main

- **WHEN** a viewport is resized from desktop to mobile
- **THEN** `inert` is removed from `#claim-gate` and `#welcome-gate`, allowing mobile gate interaction, while `<main>` remains protected under `WelcomeGate` until reveal commit

### Requirement: Background media suppression on desktop

When a visitor loads the homepage on a desktop viewport ($\ge 768\text{px}$ width and $\ge 600\text{px}$ height), the document root SHALL be marked with `data-desktop`. Client scripts for audio soundtrack preloading (`enableSoundtrack`) and collage image promotion (both parse-time and component-level in `ZoomParallax`) SHALL check for `data-desktop` and abort, preventing desktop visitors from wasting bandwidth downloading the 3.1 MB soundtrack and heavy collage assets.

#### Scenario: Desktop visitor does not download soundtrack

- **WHEN** a visitor on a desktop viewport loads the homepage and sits on `DesktopGate`
- **THEN** no network request is issued for `.mp3` soundtrack files
