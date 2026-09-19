## 1. Confirm scope and protect in-progress work

- [x] 1.1 Reviewed the dirty working tree, preserved a source safety snapshot, and retained the one-photo-per-invite rule. See handoff.md for replaced files and existing-data boundaries.
- [x] 1.2 Traced submission/story/thumbnail consumers; retired only obsolete runtime and transferred useful coverage.
- [x] 1.3 Recorded photo-normalization supersession and D9 sync disposition; production task 6.2 remains pending in the handoff and task 6.3's cache warning is retained.
- [x] 1.4 Established isolated temporary DB/storage/server/cache targets; no developer/deployed state was reset.

## 2. Replace the schema and generate the initial baseline

- [x] 2.1 Added guest-photos.ts with ID, unique invitation FK/key, timestamp and composite ordering index; removed submission schema.
- [x] 2.2 Preserved invite tracking and RSVP fields/defaults/indexes/FKs; removed stale FK documentation.
- [x] 2.3 Regenerated initial SQL, snapshot and journal together using db:generate --name=initial, with no conversion migration.
- [x] 2.4 Added actual-migrator baseline/idempotency tests with explicit temporary targets and a compatibility guard for legacy histories.
- [x] 2.5 Verified unique ownership/key constraints, application FK enforcement, integrity, absence of retired fields, and unchanged-schema generation.

## 3. Simplify photo storage while preserving image safety

- [x] 3.1 Replaced submissions helpers with guest-photos helpers and photo-scoped keys; kept cryptographic IDs and traversal checks.
- [x] 3.2 Added exclusive leaf-directory reservation, bounded collision retries and attempt-owned cleanup; tested collisions.
- [x] 3.3 Kept atomic sibling writes and partial cleanup; unique temp names permit retries after interrupted writes without touching another attempt.
- [x] 3.4 Removed positions, legacy storage formats, thumbnails, dead exports and thumbnail queue work; preserved normalization/privacy.
- [x] 3.5 Updated AVIF queue and binary route; preserved flag, bounds/deduplication, logging, fallback/self-heal, Vary and immutable caching.
- [x] 3.6 Added key, containment, collision, ownership, atomic-read and abandoned-partial regression tests.

## 4. Replace the collection and upload API

- [x] 4.1 Implemented flat public GET /api/guest-photos with inviteValid, mineId and complete timestamp/ID-ordered photos.
- [x] 4.2 Implemented singular multipart photo validation/error map, authentication-before-parsing and same-origin protection.
- [x] 4.3 Implemented normalize → reserve → write → publish → queue ordering; only invitation uniqueness maps to 409.
- [x] 4.4 Implemented owner-only cleanup and exact ID/key/owner reconciliation for uncertain inserts; never undo accepted content.
- [x] 4.5 Removed /api/submissions and old types; retained binary /api/photos and uncached collection/errors.
- [x] 4.6 Added public/stale/malformed/authenticated collection, deterministic ordering, privacy, error, validation and POST/read consistency tests.
- [x] 4.7 Added concurrent upload, pre-publication visibility, storage/collision/constraint, committed-after-error and unresolved-outcome tests.

## 5. Connect the existing magnetic trail and uploader

- [x] 5.1 Replaced submissions-client with strict flat guest-photos-client types, shared request cache, safe invalidation/retry and guest-photos:posted.
- [x] 5.2 Updated selection for the full flat pool, immutable server order, starter fill and caller-priority URL.
- [x] 5.3 Updated picker endpoint/form/errors/eligibility without redesigning its native activation, focus, indicator or layout.
- [x] 5.4 Preserved committed 201/409 state and decode-aware success; refresh-only recovery and uncertain-transport reconciliation prevent re-posts.
- [x] 5.5 Retained stale-response/disposal guards and listener cleanup; completed requests invalidate cache even after controls detach.
- [x] 5.6 Updated selection/UI/animation mocks and added shared-cache, lost-response, late-read, keyboard, disposal and remount regressions; intercept use is asserted.

## 6. Retire the old story presentation and fixtures

- [x] 6.1 Removed old story components/scripts, intro state, time helper, story-only styles and six demo assets; preserved family images.
- [x] 6.2 Retired four obsolete story suites after moving auth/photo/cache/retry coverage to current API/trail tests.
- [x] 6.3 Removed legacy runtime contracts and stale comments; source search confirms no remaining story/submission/thumbnail consumers.
- [x] 6.4 Verified no story runtime in the homepage; unrelated motion source was preserved. Existing unrelated full-suite failures are documented separately.

## 7. Update database integration and operations

- [x] 7.1 Rewrote RSVP integration against the fresh baseline, retaining upsert/first-timestamp/count tests.
- [x] 7.2 Reworked photo pipeline and retained SSR behavior using isolated current-schema fixtures; preserved privacy/codec/AVIF coverage.
- [x] 7.3 Updated restore checks to current tables with strict SQL failures; tested valid, missing-table, checksum and missing-canonical cases.
- [x] 7.4 Updated setup/operations docs with absolute targets and fresh-only semantics; verified backups/partials and corrected unsafe pruning.
- [x] 7.5 Rewrote moderation for reviewed photo ownership, stopped writers, released upload slot, cached-copy limits and offline reconciliation.
- [x] 7.6 Documented separately authorized replacement and matched rollback; no existing environment reset was performed.

## 8. Validate and prepare the coordinated release

- [x] 8.1 Ran real baseline/idempotency/drift/constraint checks on isolated targets; schema/SQL/metadata agree.
- [x] 8.2 Final focused desktop/mobile suite: 200 passed. Earlier full-suite failures outside this cleanup are documented in handoff.md.
- [x] 8.3 Type checks, production build and focused non-mutating lint/format checks passed; preserved unrelated concurrent user work.
- [x] 8.4 Real browser smoke covers empty collection, new invite, RSVP, upload, public display, duplicate rejection and reload; restore fixtures pass.
- [x] 8.5 Dry-merged/repeated/validated affected specs, applied reviewed main-spec updates and removed retired capability directories. Existing unrelated guest-greeting validation failure is documented.
- [x] 8.6 Produced handoff.md with results, fresh-target requirement, overlap disposition and unexecuted authorized-reset/production-AVIF steps.

## 9. Audit findings and review corrections

- [x] 9.1 Consolidated shared invite parsing/identity responses while preserving metric-specific route semantics.
- [x] 9.2 Removed unused direct dependencies/catalog/template config and unused CORS validation; local secret files remain operator-owned.
- [x] 9.3 Added retryable lazy FK initialization, unique temporary files for interrupted AVIF recovery, and per-instance test-server ownership checks.
- [x] 9.4 Corrected root invite URL/rebinding documentation and unsafe manual-test/deletion examples; all setup uses isolated or explicitly approved targets.
