# guest-greeting Specification

## Purpose

Personalized greeting on the black loading overlay for invite holders, rendered server-side at request time so the name is present at first paint on every visit. Public visitors see the overlay exactly as today.

## Requirements

### Requirement: Greeting element on the welcome gate

The welcome gate SHALL contain the greeting element, vertically centered in the viewport; the gate's swipe hint is a separate element pinned near the bottom and is not part of the centered group. The loading overlay SHALL NOT contain the greeting element — it renders the shimmer phrases alone.

#### Scenario: Gate centering

- **WHEN** the gate is visible
- **THEN** the greeting element is centered in the viewport, whether or not greeting text is present

#### Scenario: Anonymous visitor sees no greeting

- **WHEN** no valid invite cookie is present on the request
- **THEN** the greeting element renders empty and the gate shows only the swipe hint, indistinguishable from the pre-personalization experience

### Requirement: Greeting rendered server-side at request time

The server SHALL read the `ww_invite_id` cookie on each homepage request, resolve the invite, and render the `displayName` into the greeting element in the response HTML; no client-side fetch is required for the greeting.

#### Scenario: Invitee sees name at first paint

- **WHEN** a request arrives with a valid invite cookie
- **THEN** the response HTML already contains the invite's display name in the greeting element (no post-load fetch, no flash, no race with overlay dismissal)

#### Scenario: Unknown or malformed cookie renders empty

- **WHEN** the cookie is absent, malformed, or matches no invite
- **THEN** the greeting element renders empty (identical markup to an anonymous request) and no error is surfaced

### Requirement: Greeting text verbatim and escaped

### Requirement: Loading overlay is phrases-only

The loading overlay SHALL render only the shimmer phrases (no greeting element). This applies equally to invited and anonymous visitors.

#### Scenario: Invited landing

- **WHEN** an invited guest loads the homepage
- **THEN** the loading overlay shows shimmer phrases while awaiting hydration

#### Scenario: Anonymous landing

- **WHEN** an anonymous visitor loads the homepage
- **THEN** the loading overlay shows shimmer phrases while awaiting hydration
  The greeting SHALL render the invite's `displayName` verbatim (exactly as stored, no template-added prefix or suffix), via template auto-escaping (never parsed as HTML).

#### Scenario: Verbatim rendering

- **WHEN** the stored `displayName` is `Dear Dimas & Eva,`
- **THEN** the overlay shows exactly `Dear Dimas & Eva,`

#### Scenario: Markup in display name is inert

- **WHEN** a stored `displayName` contains HTML-special characters
- **THEN** they render as literal text with no HTML parsing

### Requirement: Homepage responses are never cached

Every homepage response SHALL carry `Cache-Control: no-store`, so a shared cache (if ever introduced) can never serve one guest's personalized HTML to another.

#### Scenario: no-store on anonymous and invited responses

- **WHEN** any homepage response is produced
- **THEN** the `Cache-Control: no-store` header is present

### Requirement: No greeting lookup side effects

The greeting resolution SHALL NOT modify invite metrics or any state.

#### Scenario: Repeated visits leave no trace

- **WHEN** the homepage is requested any number of times with the same cookie
- **THEN** `seen_at`/`seen_count` on the invite are unchanged (tracking remains exclusive to `GET /:id`)
