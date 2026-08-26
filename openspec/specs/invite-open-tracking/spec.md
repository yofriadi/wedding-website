# invite-open-tracking Specification

## Purpose

A per-invite "opened the invitation" metric. The welcome gate's reveal gesture is the strongest engagement signal the site has; this capability records it (`opened_at` / `opened_count`) through a cookie-identified, best-effort endpoint that mirrors the existing seen-metrics conventions, plus a minimal admin read side.

## Requirements

### Requirement: Open fields on invites

The `invites` table SHALL gain `opened_at` (nullable integer, epoch milliseconds of the most recent open) and `opened_count` (integer, default `0`, total recorded opens), applied via a committed migration.

#### Scenario: Migration applies additively

- **WHEN** the migration runs against an existing database
- **THEN** existing rows gain `opened_at = NULL` and `opened_count = 0` with no other schema change

### Requirement: Record an open via cookie identity

The system SHALL expose `POST /api/invite/opened` that reads the `ww_invite_id` request cookie and, when it maps to an existing invite, sets `opened_at` to the current time, increments `opened_count` by one, and responds `204`. The invite id SHALL NOT be accepted as a URL path or query parameter.

#### Scenario: Valid cookie records an open

- **WHEN** `POST /api/invite/opened` arrives with a cookie whose value is an existing invite id
- **THEN** that invite's `opened_at` is now-ish, `opened_count` increments by one, and the response is `204`

#### Scenario: Repeated opens accumulate

- **WHEN** the same invite records multiple opens
- **THEN** `opened_count` reflects the total and `opened_at` reflects the most recent

### Requirement: Uniform not-found responses

Absent, malformed, or unknown invite cookies SHALL all produce the same `404` response shape, indistinguishable from one another.

#### Scenario: Anonymous or invalid callers

- **WHEN** the endpoint is called with no cookie, a malformed cookie value, or an unknown id
- **THEN** the response is `404` with an identical body shape in all three cases and no metrics change

### Requirement: Responses are never cached

The endpoint SHALL send `Cache-Control: no-store` on every response (success and error).

#### Scenario: no-store on every response

- **WHEN** any response is produced by this endpoint
- **THEN** the `Cache-Control: no-store` header is present

### Requirement: Metrics write is best-effort

A failed metrics write SHALL NOT produce an error response visible to the caller; the server SHALL log the failure and respond as for a success.

#### Scenario: Database failure still responds

- **WHEN** the metrics update fails at the database layer
- **THEN** the failure is logged server-side and the response is `204`

### Requirement: Consumers gate calls on cookie presence

Client-side consumers of this endpoint SHALL check for the `ww_invite_id` cookie before calling, and SHALL NOT call it when the cookie is absent.

#### Scenario: Anonymous visitor performs no write

- **WHEN** a page loads in a browser with no `ww_invite_id` cookie
- **THEN** no request is made to `/api/invite/opened`

### Requirement: Admin read side

The admin invites route SHALL expose a token-gated `GET` returning each invite's `display_name`, `seen_at`, `seen_count`, `opened_at`, and `opened_count`, so the couple can see who has opened their invitation.

#### Scenario: Authenticated listing includes open metrics

- **WHEN** `GET /api/admin/:token/invites` is called with the correct admin token
- **THEN** the response lists invites with open metrics per invite

#### Scenario: Bad token is uniform

- **WHEN** the GET is called with a missing or wrong token
- **THEN** the response is the same bare `404` as the existing POST behavior
