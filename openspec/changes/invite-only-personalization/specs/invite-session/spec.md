# invite-session Spec Delta

## Purpose

Cookie-as-identity lookup layer. One read-only endpoint resolves the current visitor's invite identity from the `ww_invite_id` cookie, for consumers that need identity client-side (guest-submissions' flow now; RSVP later) — without exposing invite IDs in URLs and without allowing personalized responses to be cached. The homepage greeting does NOT consume this endpoint; it renders server-side (see guest-greeting).

## ADDED Requirements

### Requirement: Resolve current invite from cookie

The system SHALL expose `GET /api/invite/me` that reads the `ww_invite_id` request cookie and, when it maps to an existing invite, responds `200` with JSON `{ "displayName": string }`.

#### Scenario: Valid cookie resolves

- **WHEN** `GET /api/invite/me` is sent with a `ww_invite_id` cookie whose value is an existing invite id
- **THEN** the response is `200` with `{ "displayName": <the invite's display_name> }` and no other fields

#### Scenario: No cookie

- **WHEN** `GET /api/invite/me` is sent without a `ww_invite_id` cookie
- **THEN** the response is `404` and the body shape is identical to any other not-found case

#### Scenario: Malformed cookie value

- **WHEN** the cookie value is not a syntactically valid invite id (wrong length or charset)
- **THEN** the response is `404` with the same body shape as an unknown id (no distinction from unknown)

#### Scenario: Unknown cookie value

- **WHEN** the cookie value is well-formed but no matching invite row exists
- **THEN** the response is `404` with the same body shape as the malformed case

### Requirement: Consumers gate calls on cookie presence

Any client-side consumer of this endpoint SHALL check for the `ww_invite_id` cookie before calling, and SHALL NOT call it when the cookie is absent.

#### Scenario: Anonymous visitor performs no lookup

- **WHEN** a page loads in a browser with no `ww_invite_id` cookie
- **THEN** no request is made to `/api/invite/me`

### Requirement: Lookup responses are never cached

The endpoint SHALL send `Cache-Control: no-store` on every response (success and error).

#### Scenario: Success response carries no-store

- **WHEN** any response is produced by this endpoint
- **THEN** the `Cache-Control: no-store` header is present

### Requirement: Invite id stays out of lookup URLs

The lookup endpoint SHALL NOT accept the invite id as a URL path or query parameter.

#### Scenario: Identity only via cookie

- **WHEN** the client needs the current invite's display name
- **THEN** it uses `GET /api/invite/me` and the invite id appears in no URL other than the original `/i/:id` share link

### Requirement: Lookup is read-only

The lookup SHALL NOT modify invite metrics or any state.

#### Scenario: Repeated lookups leave no trace

- **WHEN** `GET /api/invite/me` is called any number of times
- **THEN** `seen_at`/`seen_count` on the invite are unchanged (tracking remains exclusive to `GET /i/:id`)
