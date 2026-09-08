## ADDED Requirements

### Requirement: One submission per invite

The system SHALL enforce at most one submission per invite, via a database-level `UNIQUE(invite_id)` constraint, and SHALL reject further attempts with `409`.

#### Scenario: First post succeeds

- **WHEN** an invite holder posts via `POST /api/submissions` with a valid cookie and no prior submission
- **THEN** a submission row is created attributed to that invite and the response is `201`

#### Scenario: Second post is rejected

- **WHEN** the same invite posts again (including concurrent attempts racing the constraint)
- **THEN** the response is `409 { "error": "already_posted" }` and no new row exists

#### Scenario: Anonymous post is rejected invisibly

- **WHEN** `POST /api/submissions` is sent without a valid invite cookie
- **THEN** the response is `404` (same body shape as invite-session not-found; endpoint behaves as nonexistent)

### Requirement: Submission requires photos

A submission SHALL contain at least one photo; a submission with no photos SHALL be rejected with `400 { "error": "empty_submission" }`. (Wishes are retired, so photos are the only submission content.)

#### Scenario: Empty submission rejected

- **WHEN** `POST /api/submissions` carries no photo
- **THEN** the response is `400` and no row is created

## MODIFIED Requirements

### Requirement: Photos served via the wall

Photo URLs SHALL be returned by `GET /api/submissions` to all callers — anonymous visitors and stale-cookie holders receive `{ mine: null, inviteValid: false, wall: { stories } }` with the same wall content resolved invitees see (minus `mine`); resolved invitees receive `inviteValid: true` and `mine`. Photos render in the story rail as story tiles with first-name attribution per the "First-name attribution on story tiles" requirement; the rail's story tiles are exactly the real wall tiles (no demo tiles exist). Files are served through the app (or a cacheable app route) with proper content-type — never via a public static directory that bypasses validation.

#### Scenario: Invitee sees guest photos in the rail

- **WHEN** a cookie holder views the story rail and photos exist
- **THEN** guest photo tiles render as the rail's only story tiles, each labeled with the poster's first name

#### Scenario: Anonymous visitor sees guest photos in the rail

- **WHEN** a visitor without a cookie views the story rail and photos exist
- **THEN** `GET /api/submissions` responds 200 with `mine: null` and the wall, and guest photo tiles render in the rail with the same first-name attribution invitees see

#### Scenario: Anonymous direct file access succeeds

- **WHEN** a valid photo path is requested without a cookie
- **THEN** the photo file is served (photos are public by decision; keys are unguessable submission-scoped paths)

#### Scenario: Anonymous rail when the wall is empty

- **WHEN** a visitor without a cookie views the story rail and no photos exist
- **THEN** the rail shows the three unnamed mock previews per the story-rail-mocks capability (the API returns an empty wall)

### Requirement: Wall payload carries poster first name and timestamp

`GET /api/submissions` SHALL include on every `wall.stories` entry and on `mine` (when non-null) a `firstName` field and a `createdAt` field (integer epoch milliseconds of the submission). `firstName` SHALL be the first whitespace-separated token of the submitting invite's `display_name`, resolved by joining `submissions.invite_id` to `invites` at read time; when the derived token is empty, `firstName` SHALL be `null` on that entry. The payload SHALL NOT include any wish field (`wall.wishes` and `mine.wishText` do not exist). No other payload field changes.

#### Scenario: First token of a couple-style display name

- **WHEN** a submission belongs to an invite whose `display_name` is `Yofriadi Yahya & Partner`
- **THEN** that submission's wall story entry carries `firstName: "Yofriadi"` and its submission `createdAt`

#### Scenario: Empty derivation yields null

- **WHEN** the first whitespace-separated token of an invite's `display_name` is empty
- **THEN** that story entry's `firstName` is `null`

#### Scenario: Own tile parity

- **WHEN** a resolved invitee fetches the payload and their submission has photos
- **THEN** `mine.firstName` equals the first token of their invite's `display_name` and `mine.createdAt` equals their submission time

#### Scenario: No wish fields in the payload

- **WHEN** any `GET /api/submissions` responds successfully
- **THEN** the response contains no `wall.wishes` array and no `mine.wishText` field

### Requirement: First-name attribution on story tiles

Real story tiles (wall entries and the caller's own tile) SHALL render the poster's first name in the tile label position and in the story modal's author header together with a relative timestamp derived from `createdAt`. The author header SHALL NOT require an avatar: a named tile without an avatar renders name plus timestamp only. Attribution SHALL be identical for every viewer class (public, stale-cookie, resolved invitee). Entries whose `firstName` is `null` SHALL render the attribution-free layout instead: a transparent filler label on the tile, and an empty attribution slot in the modal header (no placeholder text) with the close button right-aligned.

#### Scenario: Named tile label and accessible name

- **WHEN** a wall story with `firstName: "Lita"` renders in the rail
- **THEN** the tile's label span shows `Lita` and the tile's accessible label is `View Lita's stories`

#### Scenario: Modal author header shows name and timestamp

- **WHEN** a visitor opens a named story tile's modal
- **THEN** the author header shows the first name and a relative timestamp (e.g. `2h ago`), with no avatar circle

#### Scenario: Anonymous viewer parity

- **WHEN** a visitor without a cookie views a rail containing named story tiles
- **THEN** the tiles and modals render the same first-name attribution a resolved invitee sees

#### Scenario: Null first name falls back to attribution-free

- **WHEN** a story entry's `firstName` is `null`
- **THEN** the tile renders the transparent filler label and the modal header renders an empty attribution slot (no "Guest story" text), close button right-aligned
