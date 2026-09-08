# guest-photos Specification

## Purpose

TBD - created by archiving change guest-submissions. Update Purpose after archive.

## Requirements

### Requirement: Photo limits

Each submission SHALL include at most 3 photos, each at most 10MB, of allowed types (jpeg, png, webp, avif verified by magic bytes, not Content-Type alone); violations SHALL be rejected with `400`.

#### Scenario: Too many photos rejected

- **WHEN** a submission includes 4 photos
- **THEN** the response is `400` and nothing is stored

#### Scenario: Oversized photo rejected

- **WHEN** any photo exceeds 10MB
- **THEN** the response is `400` and nothing is stored

#### Scenario: Disallowed type rejected

- **WHEN** a file's magic bytes do not match an allowed image type (regardless of Content-Type or extension)
- **THEN** the response is `400` and nothing is stored

### Requirement: Photos stored on disk under submission-scoped paths

Photos SHALL be written to a local content directory outside the web root (e.g. `/srv/wedding/photos/`), keyed `submissions/<submission-id>/<position>.<ext>`; keys SHALL NOT embed invite ids or names; storage SHALL reject path traversal.

#### Scenario: Upload writes to disk

- **WHEN** a valid photo is accepted
- **THEN** the file exists at the submission-scoped path and the submission row references the key

#### Scenario: Path traversal rejected

- **WHEN** a stored key or client-supplied filename attempts to escape the content directory (`..`, absolute path)
- **THEN** the write is refused (the key is server-generated; client filenames are never trusted)

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

### Requirement: Upload failure is atomic-ish

If any photo fails validation or storage, the submission SHALL NOT be created (all-or-nothing per attempt). Because the submission row is claimed FIRST (to win the post-once race), cleanup on any non-201 path MUST delete BOTH the claimed row AND the entire generated submission directory — a surviving row would permanently lock the guest out (UNIQUE(invite_id) + no edit/delete path). "Not created" means no surviving row AND no surviving files.

#### Scenario: One bad file fails the batch

- **WHEN** a submission includes one valid and one invalid photo
- **THEN** the response is `400`, and cleanup removes the claimed submission row AND the whole generated submission directory (the guest may retry — they are not locked out)

### Requirement: Submissions API never cached; photo files cacheable

`GET /api/submissions` SHALL send `Cache-Control: no-store` on every response. The photo route `GET /api/photos/<key>` SHALL send cacheable headers suitable for immutable content (keys are write-once) and MAY be shared-cached.

#### Scenario: Submissions API never cached

- **WHEN** `GET /api/submissions` responds
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Photo route is publicly cacheable

- **WHEN** `GET /api/photos/<key>` responds successfully
- **THEN** the response carries `Cache-Control: public, max-age=31536000, immutable` (keys are write-once and unguessable; a shared cache may serve them)

#### Scenario: Missing-file responses are never cached

- **WHEN** `GET /api/photos/<key>` responds 404 (missing or malformed key)
- **THEN** the response carries `Cache-Control: no-store`

### Requirement: Guest tiles render inside the rail container

Dynamically rendered guest tiles (initial wall render and post-submit) SHALL be appended inside the rail's horizontal-scroll container — located via the container's explicit `data-story-rail` hook — never as children of the surrounding section. After a successful post, the rail's guest tile set SHALL reflect the fresh payload: all wall tiles plus the caller's own tile, not the caller's alone.

#### Scenario: Upload appears in the rail

- **WHEN** a guest posts photos and the rail re-renders
- **THEN** the new tile appears within the rail's scrollable row, after the demo/teaser tiles

#### Scenario: Post-submit keeps other guests' tiles

- **WHEN** a guest posts while other guests' tiles are in the rail
- **THEN** those tiles remain rendered after the re-sync

### Requirement: Invitee's own tile renders on initial load

For a cookie holder whose prior submission includes photos, the rail's initial client render SHALL include the caller's own tile (from `mine`) in addition to the wall — the tile SHALL NOT require a new post or appear only until reload.

#### Scenario: Posted invitee reloads

- **WHEN** a guest who has posted photos reloads the page
- **THEN** their own story tile renders in the rail on initial load

#### Scenario: Sole real story is the caller's own

- **WHEN** the only submission with photos belongs to the viewing invitee
- **THEN** the rail renders their tile (and, per story-rail-mocks, no mock tiles)

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
