# rsvp-responses Specification (delta)

## MODIFIED Requirements

### Requirement: Submit RSVP via cookie identity

The system SHALL expose `POST /api/rsvp` that resolves identity from the `ww_invite_id` request cookie (never URL or body) and upserts that invite's response. Identity SHALL be resolved BEFORE the request body is parsed or validated, so that missing, malformed, or unknown cookie values produce a uniform `404` indistinguishable from one another — and indistinguishable from any body-handling outcome for anonymous callers. The endpoint SHALL send no CORS headers (same-origin only).

A cookie that resolves to a **group invite** (valid but unclaimed identity) SHALL be rejected with `409` and body `{ "error": "claim_required" }`, writing no row; this outcome applies regardless of body validity but still follows identity resolution. Claimed member invites satisfy this contract exactly as standalone individuals do, their responses stored keyed by the member invite id.

#### Scenario: Valid invite submits

- **WHEN** `POST /api/rsvp` is sent with a `ww_invite_id` cookie mapping to a standalone individual or member invite and a valid body
- **THEN** the response is `200` with JSON `{ "attending": boolean }` echoing the stored value

#### Scenario: Group cookie submission rejected

- **WHEN** `POST /api/rsvp` is sent with a cookie mapping to a group invite and a valid body
- **THEN** the response is `409` with `{ "error": "claim_required" }`, carries `Cache-Control: no-store`, and no `rsvps` row exists for the group id

#### Scenario: Member RSVP is isolated per member

- **WHEN** two members of one group submit `attending: true` and `attending: false` respectively
- **THEN** two `rsvps` rows exist keyed by the two member ids, `GET /api/rsvp` under each member cookie returns only that member's value, and `GET /api/rsvp/count` counts the one attending member

#### Scenario: No cookie

- **WHEN** `POST /api/rsvp` is sent without a `ww_invite_id` cookie
- **THEN** the response is `404` with the same empty body shape as `GET /api/invite/me` not-found

#### Scenario: Malformed or unknown cookie

- **WHEN** the cookie value fails the invite-id pattern or matches no invite row
- **THEN** the response is `404` with the identical shape — no distinction between malformed and unknown — never `409`

#### Scenario: Anonymous caller with invalid body

- **WHEN** `POST /api/rsvp` is sent with an invalid body and no valid cookie
- **THEN** the response is `404`, not `400` — endpoint existence is not revealed by body-handling order

#### Scenario: Database outage is not a 404

- **WHEN** the lookup or write fails for an operational reason
- **THEN** the response is `503` (retryable), keeping `404` reserved for identity outcomes

## ADDED Requirements

### Requirement: Group invite reads have no stored response

`GET /api/rsvp` with a cookie resolving to a group invite SHALL behave as for any invite with no stored response — `200` with `{ "attending": null }` — because the group row itself never holds an RSVP row.

#### Scenario: Group cookie status read is empty, not an error

- **WHEN** `GET /api/rsvp` is sent with a cookie mapping to a group invite
- **THEN** the response is `200` with `{ "attending": null }`
