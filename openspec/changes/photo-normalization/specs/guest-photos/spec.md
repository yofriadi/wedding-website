# guest-photos Spec Delta

## MODIFIED Requirements

### Requirement: Photo limits

Each submission SHALL include at most 3 photos, each at most 10MB **as uploaded**, of allowed types (jpeg, png, webp, avif verified by magic bytes, not Content-Type alone); violations SHALL be rejected with `400`. The limits bound the request, not the stored artifact: an accepted photo is normalized before storage (see "Uploads are normalized to a canonical WebP"), so a 9MB 48MP upload is stored as a capped WebP. A file whose magic bytes are allowed but whose payload cannot be decoded SHALL also be rejected with `400` and `invalid_photo_type`, before any submission row is claimed.

#### Scenario: Too many photos rejected

- **WHEN** a submission includes 4 photos
- **THEN** the response is `400` and nothing is stored

#### Scenario: Oversized photo rejected

- **WHEN** any uploaded photo exceeds 10MB
- **THEN** the response is `400` and nothing is stored

#### Scenario: Disallowed type rejected

- **WHEN** a file's magic bytes do not match an allowed image type (regardless of Content-Type or extension)
- **THEN** the response is `400` and nothing is stored

#### Scenario: Undecodable payload rejected before the claim

- **WHEN** a file's magic bytes match an allowed type but its payload cannot be decoded (truncated or corrupt)
- **THEN** the response is `400` with `invalid_photo_type`, no submission row is claimed, and no file is written — the guest may retry

### Requirement: Photos stored on disk under submission-scoped paths

Photos SHALL be written to a local content directory outside the web root (e.g. `/srv/wedding/photos/`), keyed `submissions/<submission-id>/<position>.<ext>` for the canonical file, with an optional `submissions/<submission-id>/<position>.avif` variant beside it and `submissions/<submission-id>/thumb.{webp,avif}` for the per-submission cover thumbnail; keys SHALL NOT embed invite ids or names; storage SHALL reject path traversal. The canonical file SHALL be the server's own re-encode, never the client's bytes verbatim except under the pass-through rule below, and SHALL carry no camera metadata (EXIF, XMP, IPTC) — the wall is public, so a stored original would publish whatever the guest's device embedded, GPS coordinates above all. The canonical SHALL be a format every browser can decode unconditionally (WebP for anything this pipeline writes): AVIF SHALL exist only as a negotiated variant, never as a canonical. Writes SHALL be atomic — a temp file in the same directory renamed into place — so a concurrent reader can never be served a partial file, which photo caching would then hold `immutable` for a year.

#### Scenario: Upload writes to disk

- **WHEN** a valid photo is accepted
- **THEN** the file exists at the submission-scoped path as a server-generated canonical file and the submission row references the key

#### Scenario: Stored photo carries no camera metadata

- **WHEN** an upload arrives carrying EXIF (make/model, description, or GPS coordinates)
- **THEN** the stored canonical file exposes no `exif`, `xmp`, or `iptc` block

#### Scenario: Path traversal rejected

- **WHEN** a stored key or client-supplied filename attempts to escape the content directory (`..`, absolute path)
- **THEN** the write is refused (the key is server-generated; client filenames are never trusted)

#### Scenario: Variant keys stay inside the same namespace

- **WHEN** an AVIF variant is written
- **THEN** its key is the canonical key's basename with an `.avif` extension under the same submission directory, and the key regex accepts it (a variant can never introduce a new path shape)

### Requirement: Upload failure is atomic-ish

If any photo fails validation, normalization, or storage, the submission SHALL NOT be created (all-or-nothing per attempt). Validation and normalization run BEFORE the submission row is claimed, so a rejected photo leaves nothing to clean up. Because the row is claimed first (to win the post-once race), cleanup on any non-201 path after the claim MUST delete BOTH the claimed row AND the entire generated submission directory — a surviving row would permanently lock the guest out (UNIQUE(invite_id) + no edit/delete path). "Not created" means no surviving row AND no surviving files. Background AVIF variant generation is NOT part of this contract: it starts only after a 201 and its failure can never invalidate a successful submission.

#### Scenario: One bad file fails the batch

- **WHEN** a submission includes one valid and one invalid photo
- **THEN** the response is `400`, and cleanup removes the claimed submission row AND the whole generated submission directory (the guest may retry — they are not locked out)

#### Scenario: A failed variant does not un-post a submission

- **WHEN** AVIF generation fails for a photo of a submission that was accepted with `201`
- **THEN** the submission, its rows and its canonical files are untouched, the failure is logged, and the photo continues to be served as WebP

### Requirement: Submissions API never cached; photo files cacheable

`GET /api/submissions` SHALL send `Cache-Control: no-store` on every response. The photo route `GET /api/photos/<key>` SHALL send cacheable headers suitable for immutable content (keys are write-once) and MAY be shared-cached. Because the route MAY serve a different encoding for the same key depending on the request's `Accept` header, successful photo responses SHALL also send `Vary: Accept`. A shared cache that does not honor `Vary: Accept` for images (Cloudflare's free plan, for example) MUST NOT cache this route, or one visitor's AVIF can be served to a browser that cannot decode it.

#### Scenario: Submissions API never cached

- **WHEN** `GET /api/submissions` responds
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Photo route is publicly cacheable and varies on Accept

- **WHEN** `GET /api/photos/<key>` responds successfully
- **THEN** the response carries `Cache-Control: public, max-age=31536000, immutable` and `Vary: Accept`

#### Scenario: Missing-file responses are never cached

- **WHEN** `GET /api/photos/<key>` responds 404 (missing or malformed key)
- **THEN** the response carries `Cache-Control: no-store`

## ADDED Requirements

### Requirement: Uploads are normalized to a canonical WebP

Every accepted photo SHALL be re-encoded server-side before storage: EXIF orientation applied, the long edge capped at 2048px without enlarging smaller images, all metadata stripped, encoded as WebP at quality 80. The rail thumbnail SHALL be derived from the canonical file (224×400 cover, WebP quality 80) and remains mandatory — a submission with photos and no thumbnail is a failed submission.

An upload SHALL be stored as-is instead of re-encoded only when ALL of the following hold: its detected type is already **webp**, both dimensions are within the cap, its orientation is 1 or absent, it carries no EXIF/XMP/IPTC, and its byte length is no greater than the server's re-encode. JPEG, PNG and AVIF uploads SHALL always be re-encoded, even when the result is larger: for JPEG/PNG because that is the only way their metadata is provably removed, and for AVIF because an AVIF canonical would be served verbatim to browsers with no AVIF decoder (iOS ≤ 15.8, and every iOS browser is WebKit — including the in-app browser most guests arrive in).

#### Scenario: A large phone photo is capped and shrunk

- **WHEN** a guest uploads a 3000×2000 JPEG of about 1.1MB
- **THEN** the stored canonical file is a WebP of 2048×1365 (aspect preserved) and materially smaller than the upload

#### Scenario: A small image is not enlarged

- **WHEN** a guest uploads a 1000×700 image
- **THEN** the stored canonical file is 1000×700 — the cap never upscales

#### Scenario: A PNG upload becomes a WebP

- **WHEN** a guest uploads a 2MB 1000×700 PNG
- **THEN** the stored canonical file is a WebP at the same dimensions and a small fraction of the uploaded bytes

#### Scenario: An already-optimal WebP upload is not made worse

- **WHEN** a guest uploads a WebP that is within the cap, correctly oriented, metadata-free, and no larger than the server's re-encode
- **THEN** the uploaded bytes are stored unchanged under the `.webp` key

#### Scenario: A metadata-carrying WebP is re-encoded despite matching every other condition

- **WHEN** a guest uploads a WebP that is within the cap, correctly oriented and smaller than the server's re-encode, but carries EXIF
- **THEN** it is re-encoded and the stored canonical exposes no `exif`, `xmp` or `iptc`

#### Scenario: An over-cap WebP is resized even when passing it through would be smaller

- **WHEN** a guest uploads a WebP wider or taller than the cap whose bytes are smaller than the server's re-encode would be
- **THEN** the stored canonical is resized to the cap (the dimension rule is not traded away for bytes)

#### Scenario: An AVIF upload becomes a WebP canonical

- **WHEN** a guest uploads an AVIF
- **THEN** the stored canonical is a WebP at key `<position>.webp`, and an AVIF variant is generated for it out of band so AVIF-capable browsers still get the efficient format from the same URL

### Requirement: AVIF variants are generated out of band and negotiated per request

After a submission is accepted, the server SHALL queue AVIF variants for each canonical photo and for the thumbnail. Generation SHALL NOT delay the `201` response, SHALL run at bounded concurrency so a burst of uploads cannot saturate the host, and MAY be disabled by configuration (`PHOTO_AVIF_ENABLED`), in which case canonical WebP is served to everyone and already-written variants keep serving. A bounded queue that drops work at its depth cap SHALL log the drop, because a dropped job is invisible to every other surface and the operational story for this queue is "watch the journal".

`GET /api/photos/<key>` SHALL serve the AVIF variant when the request's `Accept` header explicitly lists `image/avif` with a non-zero `q` AND the variant exists; otherwise it SHALL serve the canonical file. A wildcard `Accept` (`*/*`) SHALL NOT be treated as AVIF support. The variant SHALL be served from the canonical key's URL — the wall payload, photo URLs, and clients do not change, and no `<picture>` sidecar is emitted (a sidecar that does not exist yet would break the image rather than fall back).

When an AVIF-capable request finds no variant, the route SHALL re-enqueue generation for that key and still serve the canonical file. This makes generation self-healing across restarts, dropped jobs, and photos stored before normalization existed.

#### Scenario: The first view after posting gets WebP

- **WHEN** a photo is requested immediately after its submission was accepted, before the background encode has finished
- **THEN** the response is `200` with `Content-Type: image/webp` and the canonical bytes

#### Scenario: A modern browser gets AVIF from the same URL

- **WHEN** the same photo URL is requested with `Accept: image/avif,image/webp,image/*,*/*;q=0.8` after the variant exists
- **THEN** the response is `200` with `Content-Type: image/avif`, smaller than the WebP for the same photo

#### Scenario: A browser without AVIF support never receives one

- **WHEN** the same photo URL is requested with an `Accept` that does not list `image/avif` (or lists only `*/*`), after the variant exists
- **THEN** the response is `200` with `Content-Type: image/webp`

#### Scenario: A missing variant is regenerated on demand

- **WHEN** an AVIF-capable request arrives for a photo whose variant is absent (server restarted mid-encode, or the photo predates normalization)
- **THEN** the canonical WebP is served for that request and variant generation is queued, so a later AVIF-capable request receives AVIF

#### Scenario: The thumbnail is negotiated too

- **WHEN** the rail requests `submissions/<id>/thumb.webp` with AVIF support after `thumb.avif` exists
- **THEN** the AVIF thumbnail is served from that same URL
