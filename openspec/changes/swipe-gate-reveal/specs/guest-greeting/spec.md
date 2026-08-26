# guest-greeting Spec Delta

## Purpose

Relocates the server-rendered invitee greeting from the loading overlay to the new welcome gate (see `welcome-gate`). The mechanism — cookie read, SSR at first paint, verbatim escaped text, `no-store`, no side effects — is unchanged; only the placement changes, and the loading overlay reverts to shimmer-phrases-only.

> Merge-order note: the source requirements live in the in-progress `invite-only-personalization` change. This delta assumes that change archives first.

## RENAMED Requirements

- FROM: `### Requirement: Greeting element in loading overlay`
- TO: `### Requirement: Greeting element on the welcome gate`

## MODIFIED Requirements

### Requirement: Greeting element on the welcome gate

The welcome gate SHALL contain the greeting element, vertically centered in the viewport; the gate's swipe hint is a separate element pinned near the bottom and is not part of the centered group. The loading overlay SHALL NOT contain the greeting element — it renders the shimmer phrases alone.

#### Scenario: Gate centering

- **WHEN** the gate is visible
- **THEN** the greeting element is centered in the viewport, whether or not greeting text is present

#### Scenario: Anonymous visitor sees no greeting

- **WHEN** no valid invite cookie is present on the request
- **THEN** the greeting element renders empty and the gate shows only the swipe hint, indistinguishable from the pre-personalization experience

#### Scenario: Loading overlay is phrases-only

- **WHEN** the loading overlay is visible
- **THEN** it shows only the shimmer phrases, for invited and anonymous visitors alike

### Requirement: Greeting rendered server-side at request time

The server SHALL read the `ww_invite_id` cookie on each homepage request, resolve the invite, and render the `displayName` into the greeting element (now part of the welcome gate markup) in the response HTML; no client-side fetch is required for the greeting.

#### Scenario: Invitee sees name at first gate paint

- **WHEN** a request arrives with a valid invite cookie
- **THEN** the response HTML already contains the invite's display name in the gate's greeting element (no post-load fetch, no flash, no race with the gate reveal)

#### Scenario: Unknown or malformed cookie renders empty

- **WHEN** the cookie is absent, malformed, or matches no invite
- **THEN** the greeting element renders empty (identical markup to an anonymous request) and no error is surfaced
