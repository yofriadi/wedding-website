# guest-photo-trail Specification (delta)

## MODIFIED Requirements

### Requirement: Posting eligibility comes only from resolved server state

The upload chooser SHALL become available only after a successful collection response has `inviteValid: true` and `mineId: null` AND the invite identity resolves to a non-group kind (`individual` | `member`). Cookie shape or presence SHALL NOT authorize the control. Public visitors, stale-cookie holders, unresolved/error states, and existing posters SHALL NOT open a new chooser. An existing poster's retained status or gallery-recovery control SHALL be non-posting. A visitor holding an unclaimed group invite cookie SHALL NOT open a chooser; the photo upload control SHALL remain hidden for unclaimed group visitors rather than attempting to route to an inline claim form or trigger a reload. When a visitor claims a member slot at the entry claim gate, the client-side photo trail script SHALL listen for `claim:success` on `window`, invalidate its cached identity probe, and re-probe identity state via `reloadPhotos()`, clearing the group claim block and unlocking the upload chooser under the new member identity without requiring a full page reload. The server's unique invite constraint remains authoritative regardless of client state.

Upload responses SHALL be classified by their JSON error code, never by status alone: `409 already_posted` remains the committed/race-loser path, while `409 claim_required` routes to the claim-required status and an unreadable or unrecognized error body SHALL be treated as an uncertain outcome.

#### Scenario: Eligible invitee can choose a photo

- **WHEN** the server resolves an invite with no prior photo
- **THEN** the add-image control becomes actionable and can open the picker

#### Scenario: Newly claimed member unlocks photo upload without reload

- **WHEN** a group visitor claims a member slot at the entry claim gate
- **THEN** the photo trail re-probes its identity state and the "Tambah punyamu" upload button unlocks without a page reload

#### Scenario: Unclaimed group cookie cannot upload

- **WHEN** a visitor holds an unclaimed group cookie
- **THEN** the add-image control does not open a file picker and remains hidden

#### Scenario: Cookie alone is insufficient

- **WHEN** the page has a well-shaped cookie but the request is pending, fails, or resolves it as stale
- **THEN** the control cannot open a file chooser or submit a photo

#### Scenario: Existing photo prevents a new upload

- **WHEN** a payload contains `mineId` for the caller
- **THEN** no new-upload chooser is available even if the caller reloads or refocuses the page

#### Scenario: Claim-required upload response is not a success

- **WHEN** an upload POST receives a 409 response with error code claim_required
- **THEN** the client does not mark the upload committed and shows the claim-required state

#### Scenario: Unreadable 409 body is uncertain, never committed

- **WHEN** an upload POST receives a 409 response with a non-JSON body or an unrecognized error code
- **THEN** the client treats the outcome as uncertain and triggers a collection refresh rather than marking the photo committed
