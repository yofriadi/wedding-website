# guest-greeting Spec Delta

## Purpose

Personalized greeting on the black loading overlay for invite holders, rendered server-side at request time so the name is present at first paint on every visit. Public visitors see the overlay exactly as today.

## ADDED Requirements

### Requirement: Greeting element in loading overlay

The loading overlay SHALL contain a greeting element positioned above the shimmer phrases, with both elements laid out as a single vertically-centered group in the viewport.

#### Scenario: Group centering

- **WHEN** the overlay is visible
- **THEN** the greeting element and the shimmer phrases are centered as one group (the phrases sit below the greeting element), whether or not greeting text is present

#### Scenario: Anonymous visitor sees no greeting

- **WHEN** no valid invite cookie is present on the request
- **THEN** the greeting element renders empty and the phrases render centered alone, indistinguishable from today's overlay

### Requirement: Greeting rendered server-side at request time

The server SHALL read the `ww_invite_id` cookie on each homepage request, resolve the invite, and render the `displayName` into the greeting element in the response HTML; no client-side fetch is required for the greeting.

#### Scenario: Invitee sees name at first paint

- **WHEN** a request arrives with a valid invite cookie
- **THEN** the response HTML already contains the invite's display name in the greeting element (no post-load fetch, no flash, no race with overlay dismissal)

#### Scenario: Unknown or malformed cookie renders empty

- **WHEN** the cookie is absent, malformed, or matches no invite
- **THEN** the greeting element renders empty (identical markup to an anonymous request) and no error is surfaced

### Requirement: Greeting text verbatim and escaped

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
- **THEN** `seen_at`/`seen_count` on the invite are unchanged (tracking remains exclusive to `GET /i/:id`)
