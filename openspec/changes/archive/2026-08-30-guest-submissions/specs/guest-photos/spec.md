# guest-photos Spec Delta

## Purpose

Guest photo uploads as part of the single submission: storage on the VM's local disk, hard limits, invite-only visibility, and story-rail rendering.

## ADDED Requirements

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

### Requirement: Photos served to invitees only via the wall

Photo URLs SHALL be returned by `GET /api/submissions` only to cookie holders; photos render in the story rail as story tiles without author attribution. Files are served through the app (or a cacheable app route) with proper content-type — never via a public static directory that bypasses the cookie gate.

#### Scenario: Invitee sees guest photos in the rail

- **WHEN** a cookie holder views the story rail and photos exist
- **THEN** guest photo tiles render among/after demo tiles with no name attribution

#### Scenario: Anonymous rail unchanged

- **WHEN** a visitor without a cookie views the story rail
- **THEN** the rail shows demo/teaser content only, identical to the story-teaser capability

#### Scenario: Anonymous direct file access fails

- **WHEN** a guessed photo path is requested without a valid cookie
- **THEN** the response is 404 (the file is not publicly reachable)

### Requirement: Upload failure is atomic-ish

If any photo fails validation or storage, the submission SHALL NOT be created (all-or-nothing per attempt). Because the submission row is claimed FIRST (to win the post-once race), cleanup on any non-201 path MUST delete BOTH the claimed row AND the entire generated submission directory — a surviving row would permanently lock the guest out (UNIQUE(invite_id) + no edit/delete path). "Not created" means no surviving row AND no surviving files.

#### Scenario: One bad file fails the batch

- **WHEN** a submission includes one valid and one invalid photo
- **THEN** the response is `400`, and cleanup removes the claimed submission row AND the whole generated submission directory (the guest may retry — they are not locked out)

### Requirement: Submissions API never cached; photo files cacheable

`GET /api/submissions` SHALL send `Cache-Control: no-store` on every response. The photo route `GET /api/photos/<key>` SHALL send cacheable headers suitable for immutable content (keys are write-once), while remaining cookie-gated.

#### Scenario: Submissions API never cached

- **WHEN** `GET /api/submissions` responds
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Photo route is privately cacheable but still gated

- **WHEN** `GET /api/photos/<key>` responds successfully
- **THEN** the response carries `Cache-Control: private, max-age=31536000, immutable` (browser-cached per user, never shared-cached — `public` would let a shared cache serve an invitee's authorized 200 to anyone) and remains 404 for anonymous callers

#### Scenario: Anonymous and missing-file responses are never cached

- **WHEN** `GET /api/photos/<key>` responds 404 (anonymous or missing)
- **THEN** the response carries `Cache-Control: no-store`
