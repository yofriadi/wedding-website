# rsvp-responses Specification

## Purpose

RSVP write/read API. Extends the `invite-session` cookie-as-identity contract with one mutation: an invite holder records an attending/declined response plus party size, stored as exactly one row per invite (upsert — changing one's mind is allowed). A separate public aggregate endpoint exposes only the confirmed-guest count (sum of party sizes of attending responses) for the live counter. Identity semantics — cookie-only, uniform 404, `no-store`, id out of URLs, authenticate-before-parse — match `invite-session` and the `guest-submissions` endpoint-invisibility rule exactly.

## ADDED Requirements

### Requirement: Store one RSVP per invite

The system SHALL persist RSVP responses in an `rsvps` table keyed by `invite_id` (primary key, FK to `invites.id`) with fields `attending` (boolean), `party_size` (integer), `responded_at` (epoch), `updated_at` (epoch). Re-submitting for the same invite SHALL overwrite the previous row (upsert), never create a second row; `responded_at` SHALL retain the first-response timestamp across updates.

#### Scenario: First response inserts

- **WHEN** an invite with no prior RSVP submits `attending: true, partySize: 2`
- **THEN** exactly one `rsvps` row exists for that invite id with those values and `responded_at`/`updated_at` set

#### Scenario: Changed mind updates in place

- **WHEN** an invite with an existing RSVP submits a different response
- **THEN** the same row is updated (`attending`/`party_size`/`updated_at` change), `responded_at` is unchanged, and the table still holds exactly one row for that invite id

#### Scenario: Concurrent submissions converge

- **WHEN** two RSVP submissions for the same invite race
- **THEN** the table ends with at most one row for that invite id (last write wins), and any busy/retryable storage failure surfaces as `503` rather than a partial or duplicate write

### Requirement: Per-invite party-size cap

The `invites` table SHALL carry `max_party_size` (integer, NOT NULL, default 1). A submission's `party_size` SHALL be accepted only when `1 ≤ party_size ≤ max_party_size` for attending responses. Declined responses ignore and clear party size (stored as `party_size = 0`). A stored response that exceeds a later-lowered cap remains valid and counted until the guest re-submits.

#### Scenario: Within cap accepted

- **WHEN** an invite with `max_party_size = 3` submits `attending: true, partySize: 3`
- **THEN** the response is stored and the API returns `200`

#### Scenario: Over cap rejected

- **WHEN** an invite with `max_party_size = 1` submits `attending: true, partySize: 2`
- **THEN** the response is `400` with body `{ "error": "party_size_out_of_range" }` and no row is written

#### Scenario: Malformed body rejected

- **WHEN** the POST body is not valid JSON, or `attending` is not a boolean, or `partySize` is not an integer
- **THEN** the response is `400` with body `{ "error": "invalid_body" }` and no row is written

#### Scenario: Decline stores zero party size

- **WHEN** an invite submits `attending: false`
- **THEN** the row is stored with `attending = false` and `party_size = 0` regardless of any `partySize` value sent

### Requirement: Submit RSVP via cookie identity

The system SHALL expose `POST /api/rsvp` that resolves identity from the `ww_invite_id` request cookie (never URL or body) and upserts that invite's response. Identity SHALL be resolved BEFORE the request body is parsed or validated, so that missing, malformed, or unknown cookie values produce a uniform `404` indistinguishable from one another — and indistinguishable from any body-handling outcome for anonymous callers. The endpoint SHALL send no CORS headers (same-origin only).

#### Scenario: Valid invite submits

- **WHEN** `POST /api/rsvp` is sent with a valid `ww_invite_id` cookie and a valid body
- **THEN** the response is `200` with JSON `{ "attending": boolean, "partySize": number }` echoing the stored values

#### Scenario: No cookie

- **WHEN** `POST /api/rsvp` is sent without a `ww_invite_id` cookie
- **THEN** the response is `404` with the same empty body shape as `GET /api/invite/me` not-found

#### Scenario: Malformed or unknown cookie

- **WHEN** the cookie value fails the invite-id pattern or matches no invite row
- **THEN** the response is `404` with the identical shape — no distinction between malformed and unknown

#### Scenario: Anonymous caller with invalid body

- **WHEN** `POST /api/rsvp` is sent with an invalid body and no valid cookie
- **THEN** the response is `404`, not `400` — endpoint existence is not revealed by body-handling order

#### Scenario: Database outage is not a 404

- **WHEN** the lookup or write fails for an operational reason
- **THEN** the response is `503` (retryable), keeping `404` reserved for identity outcomes

### Requirement: Read own RSVP status

The system SHALL expose `GET /api/rsvp` (same route) that resolves the cookie identity and responds `200` with `{ "attending": boolean, "partySize": number, "maxPartySize": number }` when a response exists, `{ "attending": null, "partySize": null, "maxPartySize": number }` when the invite is valid but has not responded, and uniform `404` for missing/malformed/unknown cookies.

#### Scenario: Responded invite reads status

- **WHEN** `GET /api/rsvp` is sent with a cookie for an invite that has responded
- **THEN** the response is `200` with that invite's stored `attending`/`partySize` and its `maxPartySize`

#### Scenario: Unresponded invite reads status

- **WHEN** `GET /api/rsvp` is sent with a cookie for a valid invite with no RSVP row
- **THEN** the response is `200` with `attending: null, partySize: null` and the invite's `maxPartySize`

#### Scenario: Anonymous read is not-found

- **WHEN** `GET /api/rsvp` is sent without a valid cookie
- **THEN** the response is `404` with the uniform not-found shape

### Requirement: Public confirmed-guest count

The system SHALL expose `GET /api/rsvp/count` that responds `200` with `{ "count": number }` where count is the sum of `party_size` over all rows with `attending = true`. The endpoint SHALL require no cookie and SHALL return only the aggregate integer — never per-invite data, names, or row enumerations.

#### Scenario: Count sums attending party sizes

- **WHEN** three invites have responded attending with party sizes 2, 1, and 4, and one has declined
- **THEN** `GET /api/rsvp/count` returns `{ "count": 7 }`

#### Scenario: No responses yet

- **WHEN** no `rsvps` rows exist
- **THEN** `GET /api/rsvp/count` returns `200` with `{ "count": 0 }`

#### Scenario: Anonymous access allowed

- **WHEN** `GET /api/rsvp/count` is sent with no cookies at all
- **THEN** the response is `200` with the count

### Requirement: RSVP responses are never cached

Every response from `/api/rsvp` and `/api/rsvp/count` (success and error) SHALL carry `Cache-Control: no-store`.

#### Scenario: All responses carry no-store

- **WHEN** any response is produced by either endpoint
- **THEN** the `Cache-Control: no-store` header is present

### Requirement: Invite id stays out of RSVP URLs

The RSVP endpoints SHALL NOT accept the invite id as a URL path, query parameter, or body field.

#### Scenario: Identity only via cookie

- **WHEN** a client submits or reads an RSVP
- **THEN** the invite id appears only in the `ww_invite_id` cookie and in no URL or payload

### Requirement: RSVP writes do not touch invite metrics

RSVP submission and status reads SHALL NOT modify `seen_at`/`seen_count`/`opened_at`/`opened_count` on the invite.

#### Scenario: Metrics unchanged by RSVP activity

- **WHEN** an invite submits an RSVP and then reads its status repeatedly
- **THEN** all four metrics columns on the invite row are unchanged

### Requirement: Admin surface for party-size caps and RSVP visibility

The admin invites endpoint (`/api/admin/:token/invites`) SHALL accept an optional `maxPartySize` on invite creation (default 1) and SHALL include `maxPartySize` plus each invite's RSVP state (`attending`, `partySize` when a row exists) in its list response.

#### Scenario: Create invite with cap

- **WHEN** an admin creates an invite with `maxPartySize: 4`
- **THEN** the invite row is stored with `max_party_size = 4`

#### Scenario: Cap defaults to one

- **WHEN** an admin creates an invite without `maxPartySize`
- **THEN** the invite row is stored with `max_party_size = 1`

#### Scenario: List includes RSVP state

- **WHEN** an admin lists invites after responses exist
- **THEN** each invite entry includes its `maxPartySize` and, where a response exists, its `attending` and `partySize`
