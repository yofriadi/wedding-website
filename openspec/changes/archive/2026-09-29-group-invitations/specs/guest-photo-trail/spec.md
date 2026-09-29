# guest-photo-trail Specification (delta)

## MODIFIED Requirements

### Requirement: Posting eligibility comes only from resolved server state

The upload chooser SHALL become available only after a successful collection response has `inviteValid: true` and `mineId: null`, and — when the caller's identity resolves to a **group invite** — only after that visitor has claimed a member slot. Cookie shape or presence SHALL NOT authorize the control. Public visitors, stale-cookie holders, unresolved/error states, unclaimed group-cookie visitors, and existing posters SHALL NOT open a new chooser. An existing poster's retained status or gallery-recovery control SHALL be non-posting. The server's unique invite constraint remains authoritative regardless of client state.

For a group-cookie visitor the surface SHALL present the name-prompt claim flow (or the read-only capacity state when the group's quota is exhausted) in place of the upload chooser, using the identity state from `GET /api/invite/me`; a successful claim SHALL trigger a full page reload so every surface re-renders consistently under the member identity. Upload responses SHALL be classified by their JSON error code, never by status alone: `409 already_posted` remains the committed/race-loser path, while `409 claim_required` routes to the claim flow and an unreadable or unrecognized error body SHALL be treated as an uncertain outcome (refresh, never committed).

#### Scenario: Eligible invitee can choose a photo

- **WHEN** the server resolves a standalone individual or member invite with no prior photo
- **THEN** the add-image control becomes actionable and can open the picker

#### Scenario: Unclaimed group identity cannot choose a photo

- **WHEN** the visitor's cookie maps to a group invite (with or without open slots) and no member slot has been claimed
- **THEN** the add-image control does not become actionable; the claim prompt (slots open) or capacity state (quota full) is shown instead

#### Scenario: Claim success unlocks the uploader

- **WHEN** a group-cookie visitor completes the claim flow
- **THEN** the page reloads under the member identity and the add-image control becomes actionable per the normal eligibility rules

#### Scenario: Claim-required upload response is not a success

- **WHEN** an upload attempt receives `409` with `{ "error": "claim_required" }` (e.g. a stale page after a release)
- **THEN** the client does NOT enter the committed state, shows no upload-success or sync-error messaging, and routes to the claim flow

#### Scenario: Unreadable 409 body is uncertain, never committed

- **WHEN** an upload attempt receives a `409` whose body cannot be parsed or whose error code is unrecognized
- **THEN** the client follows the uncertain-outcome refresh path and never marks the upload committed

#### Scenario: Cookie alone is insufficient

- **WHEN** the page has a well-shaped cookie but the request is pending, fails, or resolves it as stale
- **THEN** the control cannot open a file chooser or submit a photo

#### Scenario: Existing photo prevents a new upload

- **WHEN** a payload contains `mineId` for the caller
- **THEN** no new-upload chooser is available even if the caller reloads or refocuses the page
