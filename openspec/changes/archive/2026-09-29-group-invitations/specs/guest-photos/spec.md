# guest-photos Specification (delta)

## MODIFIED Requirements

### Requirement: One photo per invite

The system SHALL enforce at most one accepted guest photo per invite through database-level `UNIQUE(guest_photos.invite_id)`. `POST /api/guest-photos` SHALL resolve the invitation from the existing cookie before reading or validating the body. Missing, malformed, and unknown cookies SHALL receive the same empty `404` as invite-session not-found; database-resolution errors SHALL receive unavailable responses. Further uploads for an invite with a photo SHALL return `409 { "error": "already_posted" }`. Primary-key, key, foreign-key, busy, or unrelated database errors SHALL NOT be classified as already posted. Existing same-origin mutation protections SHALL remain enforced.

A cookie that resolves to a **group invite** (valid but unclaimed identity) SHALL return `409 { "error": "claim_required" }` before any body handling, persisting nothing — no member row, no photo row, no reserved files. `already_posted` and `claim_required` are the only two `409` outcomes of this endpoint, and clients SHALL branch on the response's error code, never on the `409` status alone. Claimed member invites satisfy this contract exactly as standalone individuals do, each holding their own single photo slot.

#### Scenario: First post succeeds

- **WHEN** an invite holder with no prior photo sends a valid single-photo upload
- **THEN** one photo row is published for that invite and the response is `201`

#### Scenario: Second post is rejected

- **WHEN** the same invite attempts another valid upload, including a concurrent constraint loser
- **THEN** the response is `409 already_posted` and no second photo row survives

#### Scenario: Group cookie upload rejected

- **WHEN** an upload is sent with a cookie mapping to a group invite and an otherwise-valid photo
- **THEN** the response is `409 { "error": "claim_required" }`, carries `Cache-Control: no-store`, and no photo row, photo file, or directory is created for the group id

#### Scenario: Anonymous post is rejected invisibly

- **WHEN** an upload is sent without a valid invite cookie, including with an invalid request body
- **THEN** the response is the uniform empty `404` before body validation or storage work — never `409`

#### Scenario: Database failure is not an identity miss

- **WHEN** resolving the invite fails because the database is unavailable
- **THEN** the response is `503`, not an identity `404` or duplicate `409`

#### Scenario: Other constraints are not duplicate invitations

- **WHEN** a primary-key, storage-key, foreign-key, or unrelated persistence failure occurs
- **THEN** it follows the collision/retryable failure handling and is not reported as `already_posted` solely because it is a constraint error

## ADDED Requirements

### Requirement: Member photo slots are independent

Each member invite of a group holds its own photo slot via the existing `UNIQUE(guest_photos.invite_id)` constraint; one member's upload SHALL NOT affect another member's slot, and the group invite row itself SHALL never hold a photo row. `GET /api/guest-photos` with a group cookie behaves as for any invite with no photo (`inviteValid: true`, `mineId: null`).

#### Scenario: Each member owns one photo slot

- **WHEN** two members of one group each upload an accepted photo
- **THEN** two `guest_photos` rows exist keyed by the two member ids, each member's collection read reports only their own `mineId`, and a second upload by either member is rejected exactly as a duplicate standalone-individual upload would be (`409 already_posted`)

#### Scenario: Group cookie collection read is empty, not an error

- **WHEN** `GET /api/guest-photos` is sent with a cookie mapping to a group invite that itself has no photo row
- **THEN** the response is `200` with `inviteValid: true` and `mineId: null`
