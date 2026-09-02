## MODIFIED Requirements

### Requirement: Photos served via the wall

Photo URLs SHALL be returned by `GET /api/submissions` to all callers — anonymous visitors and stale-cookie holders receive `{ mine: null, inviteValid: false, wall: { wishes, stories } }` with the same wall content resolved invitees see (minus `mine`); resolved invitees receive `inviteValid: true` and `mine`. Photos render in the story rail as story tiles with first-name attribution per the "First-name attribution on story tiles" requirement; the rail's story tiles are exactly the real wall tiles (no demo tiles exist). Files are served through the app (or a cacheable app route) with proper content-type — never via a public static directory that bypasses validation.

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

## ADDED Requirements

### Requirement: Wall payload carries poster first name and timestamp

`GET /api/submissions` SHALL include on every `wall.stories` entry and on `mine` (when non-null) a `firstName` field and a `createdAt` field (integer epoch milliseconds of the submission). `firstName` SHALL be the first whitespace-separated token of the submitting invite's `display_name`, resolved by joining `submissions.invite_id` to `invites` at read time; when the derived token is empty, `firstName` SHALL be `null` on that entry. Wish entries SHALL NOT carry any name, author, or timestamp field. No other payload field changes.

#### Scenario: First token of a couple-style display name

- **WHEN** a submission belongs to an invite whose `display_name` is `Yofriadi Yahya & Partner`
- **THEN** that submission's wall story entry carries `firstName: "Yofriadi"` and its submission `createdAt`

#### Scenario: Empty derivation yields null

- **WHEN** the first whitespace-separated token of an invite's `display_name` is empty
- **THEN** that story entry's `firstName` is `null`

#### Scenario: Own tile parity

- **WHEN** a resolved invitee fetches the payload and their submission has photos
- **THEN** `mine.firstName` equals the first token of their invite's `display_name` and `mine.createdAt` equals their submission time

#### Scenario: Wishes stay name-free

- **WHEN** the wall contains wishes
- **THEN** every wish entry is `{ text }` with no name, author, or timestamp field

### Requirement: First-name attribution on story tiles

Real story tiles (wall entries and the caller's own tile) SHALL render the poster's first name in the tile label position and in the story modal's author header together with a relative timestamp derived from `createdAt`. The author header SHALL NOT require an avatar: a named tile without an avatar renders name plus timestamp only. Attribution SHALL be identical for every viewer class (public, stale-cookie, resolved invitee). Entries whose `firstName` is `null` SHALL render the attribution-free layout instead (transparent filler label on the tile, "Guest story" placeholder in the modal header).

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
- **THEN** the tile renders the transparent filler label and the modal header renders the "Guest story" placeholder
