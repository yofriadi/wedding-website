# guest-photos Specification

## Purpose

Public, identity-minimal guest photos: one safe, immutable photo per invitation, with flat collection reads, invite-only uploads, and ownership-safe persistence.

## Requirements

### Requirement: Photo limits

Each upload SHALL include exactly one photo no larger than 10 * 1024 * 1024 bytes as uploaded. Allowed input types SHALL be JPEG, PNG, WebP, and AVIF verified by magic bytes and decoder validation, not Content-Type or extension alone. More than one `photo` entry SHALL return `400 too_many_photos`; oversized input SHALL return `400 photo_too_large`; unsupported or undecodable content SHALL return `400 invalid_photo_type`. Validation/normalization SHALL finish before any persistent row or file write.

#### Scenario: Too many photos rejected

- **WHEN** an authorized upload contains two or more `photo` entries
- **THEN** the response is `400 too_many_photos` and nothing is persisted

#### Scenario: Oversized photo rejected

- **WHEN** the uploaded photo exceeds 10 MiB
- **THEN** the response is `400 photo_too_large` and nothing is persisted

#### Scenario: Disallowed type rejected

- **WHEN** magic bytes do not match an allowed type regardless of declared MIME type or extension
- **THEN** the response is `400 invalid_photo_type` and nothing is persisted

#### Scenario: Undecodable content rejected

- **WHEN** allowed magic bytes accompany content that cannot be decoded within the input limits
- **THEN** the response is `400 invalid_photo_type`, no directory is reserved, and no row is inserted

### Requirement: Upload failure is atomic-ish

For ordinary handled validation, normalization, storage, or definitive insertion failures, an upload SHALL leave no published row and SHALL remove its owned files. The row SHALL be published only after the canonical file is complete. Accepted rows/canonicals SHALL NOT be removed because a later response, refresh, or optional variant operation fails. A persistence result that is genuinely uncertain SHALL be reconciled by the attempt's generated ID/key before destructive cleanup: confirmed publication counts as accepted, confirmed absence permits cleanup, and an unresolved result SHALL preserve possibly referenced files, log the condition, and return unavailable. Cleanup failures SHALL be logged for offline reconciliation rather than silently treated as a successful clean rollback.

#### Scenario: Invalid input leaves nothing to clean up

- **WHEN** validation or normalization fails
- **THEN** no guest-photo row or photo directory has been created and the invite remains eligible

#### Scenario: Storage failure permits retry

- **WHEN** writing the canonical fails before publication
- **THEN** no photo row is inserted, the attempt's files are cleaned up when storage permits, and the guest is not locked out by a claimed row

#### Scenario: Collection does not expose incomplete upload

- **WHEN** a collection read runs while a canonical upload is still being written
- **THEN** the unfinished photo is absent from the collection

#### Scenario: Definitive insert failure cleans only the attempt

- **WHEN** insertion is definitively rejected after the canonical was written
- **THEN** the failed attempt's directory is removed, no accepted row is deleted, and the response reflects the specific failure

#### Scenario: Exception after persistence is reconciled

- **WHEN** insertion reports an error but reconciliation finds this attempt's row and key persisted
- **THEN** the upload is treated as accepted and its canonical is not deleted

#### Scenario: Insert outcome cannot be established

- **WHEN** both the insert outcome and a reconciliation read remain unavailable
- **THEN** the server returns `503`, preserves possibly referenced files, and logs the unresolved attempt for recovery

#### Scenario: Variant failure does not undo publication

- **WHEN** AVIF work fails after a photo was accepted
- **THEN** its row and WebP remain unchanged and publicly usable

### Requirement: Guest photo API never cached; photo files cacheable

The replacement collection endpoint `GET /api/guest-photos` and all upload responses SHALL send `Cache-Control: no-store`, including errors and caller-specific posting state. The public photo file route SHALL send `Cache-Control: public, max-age=31536000, immutable` and `Vary: Accept` on successful file responses. Missing/malformed file responses SHALL be uncached. A shared image cache that does not honor `Vary: Accept` SHALL NOT be configured for negotiated photo responses.

#### Scenario: Collection responses never cached

- **WHEN** `/api/guest-photos` returns a collection, accepted upload, or error response
- **THEN** it carries `Cache-Control: no-store`

#### Scenario: Photo route is publicly cacheable

- **WHEN** `GET /api/photos/<key>` serves a valid file without an invite cookie
- **THEN** it succeeds with the correct served content type, immutable public caching, and `Vary: Accept`

#### Scenario: Missing-file responses are never cached

- **WHEN** the file route returns `404` for a missing or malformed key
- **THEN** it carries `Cache-Control: no-store`

### Requirement: One photo per invite

The system SHALL enforce at most one accepted guest photo per invite through database-level `UNIQUE(guest_photos.invite_id)`. `POST /api/guest-photos` SHALL resolve the invitation from the existing cookie before reading or validating the body. Missing, malformed, and unknown cookies SHALL receive the same empty `404` as invite-session not-found; database-resolution errors SHALL receive unavailable responses. Further uploads for an invite with a photo SHALL return `409 { "error": "already_posted" }`. Primary-key, key, foreign-key, busy, or unrelated database errors SHALL NOT be classified as already posted. Existing same-origin mutation protections SHALL remain enforced.

#### Scenario: First post succeeds

- **WHEN** an invite holder with no prior photo sends a valid single-photo upload
- **THEN** one photo row is published for that invite and the response is `201`

#### Scenario: Second post is rejected

- **WHEN** the same invite attempts another valid upload, including a concurrent constraint loser
- **THEN** the response is `409 already_posted` and no second photo row survives

#### Scenario: Anonymous post is rejected invisibly

- **WHEN** an upload is sent without a valid invite cookie, including with an invalid request body
- **THEN** the response is the uniform empty `404` before body validation or storage work

#### Scenario: Database failure is not an identity miss

- **WHEN** resolving the invite fails because the database is unavailable
- **THEN** the response is `503`, not an identity `404` or duplicate `409`

#### Scenario: Other constraints are not duplicate invitations

- **WHEN** a primary-key, storage-key, foreign-key, or unrelated persistence failure occurs
- **THEN** it follows the collision/retryable failure handling and is not reported as `already_posted` solely because it is a constraint error

### Requirement: Upload requires one photo

An authorized upload SHALL contain one `photo` file. A multipart request with no photo and no unknown fields SHALL return `400 { "error": "empty_photo" }` and SHALL create neither a row nor files. Photo-less records SHALL NOT exist in the new model.

#### Scenario: Empty upload rejected

- **WHEN** an authorized request contains no photo
- **THEN** the response is `400 empty_photo` and nothing is persisted

### Requirement: One photo row represents one invite's upload

The system SHALL store accepted guest photos in `guest_photos` with non-null `id` (text primary key), `invite_id` (unique text FK to `invites.id`), `key` (unique canonical storage key), and `created_at` (integer epoch milliseconds). A `(created_at, id)` index SHALL support deterministic collection ordering. Photo IDs SHALL be server-generated 12-character URL-safe random identifiers independent of invitation identifiers. There SHALL be no submission parent row, position field, wish field, or stored author name.

#### Scenario: Accepted photo persisted

- **WHEN** an invite successfully uploads its photo
- **THEN** exactly one `guest_photos` row references that invite and its canonical key, with no submission or child-photo row

#### Scenario: Duplicate ownership rejected by the database

- **WHEN** two photo rows would reference the same invite
- **THEN** the unique invite constraint prevents both from persisting

#### Scenario: Storage keys cannot alias

- **WHEN** a second row attempts to reuse another photo's canonical key
- **THEN** the unique key constraint rejects it rather than allowing two rows to own the same files

### Requirement: Photos use a photo-scoped immutable storage namespace

Canonical files SHALL be stored outside the web root under `guest-photos/<photo-id>/photo.webp`, with an optional `guest-photos/<photo-id>/photo.avif` derived variant. Keys SHALL contain neither invite IDs nor guest names. The server SHALL reject unsupported key shapes, traversal, absolute paths, old `submissions/` keys, position filenames, thumbnails, and temporary files. The route SHALL retain resolved-root containment checks. Successful stored keys SHALL be write-once; no upload shall overwrite another attempt's namespace.

#### Scenario: Canonical upload path

- **WHEN** a photo is accepted
- **THEN** its row key is `guest-photos/<photo-id>/photo.webp` and the canonical file exists under the configured private storage root

#### Scenario: Unsafe or obsolete key rejected

- **WHEN** a requested key contains traversal, an absolute path, a legacy submission path, a thumbnail, or a `.part` filename
- **THEN** the photo route responds with the uniform uncached `404` and does not serve file bytes

#### Scenario: Client filename is not a storage key

- **WHEN** an uploaded file has a malicious filename or misleading extension
- **THEN** the filename cannot choose the storage path or override content detection

### Requirement: Public collection is flat and identity-minimal

`GET /api/guest-photos` SHALL return `200` with `{ inviteValid: boolean, mineId: string | null, photos: Array<{ id: string, photoUrl: string, createdAt: number }> }` on successful reads. `photos` SHALL include every persisted photo exactly once, including the caller's, ordered by `created_at DESC, id DESC`. `mineId` SHALL be the photo ID associated with the server-resolved cookie or null. Missing, malformed, and unknown cookies SHALL receive the same public collection with `inviteValid: false` and `mineId: null`; valid invites SHALL receive `inviteValid: true`. The response SHALL NOT expose invite IDs, names, first names, separate storage-key fields, wishes, nested stories, or thumbnail URLs.

#### Scenario: Anonymous public read

- **WHEN** a visitor without a cookie requests the collection
- **THEN** it returns `200`, the complete public photos array, `inviteValid: false`, and `mineId: null`

#### Scenario: Stale or malformed cookie reads public state

- **WHEN** the request cookie is malformed or no longer maps to an invite
- **THEN** the collection still returns `200` with public photo content and ineligible posting state

#### Scenario: Own photo is identified without duplication

- **WHEN** an invite with a prior photo requests the collection
- **THEN** `mineId` equals its photo ID and that photo occurs once in `photos`, not in a separate duplicated object

#### Scenario: Equal timestamps have stable order

- **WHEN** multiple photos have the same creation timestamp
- **THEN** their collection order is determined by descending photo ID

#### Scenario: Identity data does not leak

- **WHEN** any successful collection response is serialized
- **THEN** it contains no invite identifiers, guest display names, first-name attribution, wish fields, or story/thumbnail payload fields

#### Scenario: Database error is not an empty gallery

- **WHEN** invite resolution or the collection query encounters an actual database failure
- **THEN** the response is unavailable (`503`) rather than `200` with an empty or falsely ineligible result

### Requirement: Upload request and response are photo-specific

`POST /api/guest-photos` SHALL accept multipart form data with exactly one file named `photo` and respond on success with `201 { id, photoUrl, createdAt }` matching the published collection entry. Malformed or non-multipart bodies, non-file values for `photo`, and unknown fields SHALL return `400 { "error": "invalid_body" }` for authorized callers. The old `/api/submissions` endpoint and plural `photos` form contract SHALL NOT remain compatibility aliases.

#### Scenario: New request contract succeeds

- **WHEN** an eligible invite sends one valid multipart `photo` file
- **THEN** the route returns `201` with one flat photo object whose ID, URL, and timestamp match a subsequent collection read

#### Scenario: Legacy or unrelated fields rejected

- **WHEN** an authorized request uses `photos`, wish text, another unknown field, or a string in place of the photo file
- **THEN** it returns `400 invalid_body` and persists nothing

#### Scenario: Retired collection endpoint

- **WHEN** a client calls `/api/submissions` after the coordinated replacement
- **THEN** no legacy guest-submission handler serves the request

### Requirement: Canonical photos retain normalization and privacy guarantees

Before persistence, every accepted image SHALL have orientation applied, its longest edge capped at 2048 pixels without enlargement, EXIF/XMP/IPTC metadata stripped, and a WebP canonical produced at quality 80. Decoder input SHALL retain the existing 64-million-pixel limit. Only an uploaded WebP that is within the cap, orientation 1 or absent, metadata-free, and no larger than the server's re-encode SHALL pass through unchanged. JPEG, PNG, and AVIF inputs SHALL always be re-encoded to WebP. No thumbnail or archival original SHALL be generated or required for acceptance.

#### Scenario: Large phone image is normalized

- **WHEN** an allowed photo exceeds the output dimension cap
- **THEN** its canonical preserves aspect ratio within 2048 pixels on the long edge, with applied orientation and no EXIF/XMP/IPTC

#### Scenario: Small image is not enlarged

- **WHEN** an allowed input is smaller than the output cap
- **THEN** normalization does not increase its pixel dimensions

#### Scenario: Already optimal WebP is preserved

- **WHEN** a WebP meets every pass-through condition
- **THEN** its bytes are stored unchanged under the canonical WebP key

#### Scenario: Metadata prevents pass-through

- **WHEN** an otherwise optimal WebP contains camera metadata
- **THEN** it is re-encoded and the published canonical exposes no EXIF/XMP/IPTC

#### Scenario: AVIF input remains safe for non-AVIF browsers

- **WHEN** a guest uploads an accepted AVIF
- **THEN** the canonical is WebP and any AVIF output is a derived optional variant, not the unconditional fallback

#### Scenario: Acceptance does not create story artifacts

- **WHEN** the upload completes
- **THEN** no `thumb.webp`, `thumb.avif`, position-named file, or original-upload copy is created

### Requirement: Optional AVIF delivery remains non-blocking and safe

After confirmed publication, the server SHALL enqueue the canonical photo for optional AVIF generation without awaiting the encode before responding. The queue SHALL retain bounded concurrency/depth, deduplication, non-fatal error/drop logging, and `PHOTO_AVIF_ENABLED` behavior. The canonical URL SHALL serve an available AVIF variant only when the request explicitly allows `image/avif` with a nonzero quality value; wildcard acceptance alone SHALL NOT imply support. Missing variants SHALL fall back to canonical WebP and be eligible for the existing GET-triggered requeue behavior. Disabling generation SHALL not disable serving an already available negotiated variant.

#### Scenario: Variant is not ready yet

- **WHEN** the canonical URL is requested immediately after acceptance before AVIF output exists
- **THEN** the request succeeds with canonical WebP rather than a broken sidecar request

#### Scenario: Supported variant is served

- **WHEN** an available variant is requested through the canonical URL with explicit nonzero AVIF support
- **THEN** the response uses `Content-Type: image/avif` and the variant bytes

#### Scenario: Wildcard or zero-quality AVIF uses WebP

- **WHEN** the request advertises only wildcard image support or explicitly sets AVIF quality to zero
- **THEN** it receives canonical WebP even if a variant exists

#### Scenario: Background generation fails

- **WHEN** an encode fails or work is dropped at the queue cap
- **THEN** the condition is logged, the accepted row/canonical remain intact, and normal photo serving continues

#### Scenario: Missing variant is retried

- **WHEN** an AVIF-capable request finds no variant after a restart or dropped job and generation is enabled
- **THEN** the route serves canonical WebP now and enqueues a deduplicated variant attempt

### Requirement: File writes and cleanup are owned by one attempt

Every upload SHALL reserve a fresh server-generated photo directory exclusively before writing. An existing directory SHALL trigger ID regeneration or a retryable failure, never an overwrite. Canonical and variant writes SHALL use same-directory temporary files followed by atomic rename. Cleanup SHALL remove only files/directories positively owned by the failed attempt, never delete by invite ID, and never remove another accepted upload. Crashes or unresolved cleanup SHALL be logged/recoverable through an offline, writers-stopped reconciliation procedure rather than automatic live directory deletion.

#### Scenario: Concurrent duplicate uploads

- **WHEN** two valid uploads for the same invite race
- **THEN** at most one row is published, a losing attempt cleans up only its own reserved directory, and the winner's files remain readable

#### Scenario: Generated ID collides

- **WHEN** a generated photo ID names a directory already owned by another attempt or accepted photo
- **THEN** no file in that directory is overwritten or removed and the new attempt retries with a fresh ID or returns unavailable

#### Scenario: Reader overlaps a file write

- **WHEN** a canonical or AVIF file is being written
- **THEN** a reader can observe only the completed renamed file or an absent file, never a partially written immutable response

#### Scenario: Orphan is found after a crash

- **WHEN** an offline reconciliation is performed with all writers and variant jobs stopped
- **THEN** an unreferenced generated directory can be identified without treating a live in-progress upload as garbage or changing an accepted row
