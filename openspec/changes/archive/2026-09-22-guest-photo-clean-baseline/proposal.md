## Why

The homepage now uses `MagneticImageTrail` with a single-photo, post-once uploader, but persistence and API contracts still model multi-photo stories, attributed rail tiles, and thumbnails. There are no users or guest records to preserve, so replacing the migration history with a clean baseline is simpler than extending obsolete tables and compatibility paths.

## What Changes

- **BREAKING**: Replace `submissions` and `submission_photos` with `guest_photos`: one photo row per invite, with a server-generated ID, unique invite reference, unique storage key, and creation timestamp.
- **BREAKING**: Replace `/api/submissions` with `/api/guest-photos` for public collection reads and invite-only single-photo uploads. Return a flat photo list plus server-resolved posting state, not `mine`/`wall.stories`, names, or thumbnail URLs.
- **BREAKING**: Replace submission-position storage paths with photo-scoped canonical WebP and optional AVIF files. Remove legacy position compatibility and story thumbnails; preserve image validation, metadata stripping, normalization, atomic file writes, and negotiated AVIF delivery.
- Connect the existing magnetic trail and sticky upload control to the new contract without redesigning their animation. Preserve rotation through the complete guest-photo pool, post-once enforcement, and refresh-only retry after a committed upload. The trail renders exactly the collected guest photos — no starter fillers, no repeats, and an empty collection renders nothing.
- Retire the unused story viewer, story rail, add-story modal, mock tiles, intro flow, and their obsolete requirements/tests after verifying remaining consumers.
- **BREAKING**: Replace migrations `0000`–`0005` and their Drizzle snapshots/journal with one generated initial migration. Preserve the current `invites` tracking fields and `rsvps` schema without party-size columns. This is a fresh-install baseline, not an upgrade or data-conversion migration.
- Update migration tests, operational restore checks, moderation instructions, and setup documentation. Reset an existing environment only as a separately confirmed operation against an explicitly identified disposable target.

## Capabilities

### New Capabilities

- `database-baseline`: Reproducible empty-database initialization, schema/metadata consistency, current invite/RSVP preservation, safe reset boundaries, and verification of the new table in restore checks.
- `guest-photo-trail`: Flat public-photo presentation in `MagneticImageTrail` showing exactly the collected photos (each once, empty stays empty), one-photo invite-only selection/upload, posting feedback, and recovery without duplicate uploads.

### Modified Capabilities

- `guest-photos`: Replace submission grouping, storage paths, collection API, and attribution with the one-photo model; preserve public reads, cookie-gated writes, normalization, caching, and safe failure behavior.
- `add-story-flow`: Retire all add-story tile, intro, modal, and modal-specific state/animation requirements in favor of `guest-photo-trail`.
- `story-rail-mocks`: Retire all mock story tiles and hidden example-viewer requirements; family starter images are presentation-only assets, not guest records.
- `interaction-motion`: Remove story-viewer-only motion requirements and references to deleted add-story controls; preserve unrelated FAQ, RSVP, loading, and map behavior.

## Impact

- Database: `packages/db/src/schema/`, `packages/db/src/migrations/`, Drizzle initialization tests, and setup instructions. No new database engine or dependency.
- Server: collection routes, photo storage/key helpers, image encoding/AVIF queue integration, uniqueness-error handling, and public photo serving under `apps/web/src/`.
- Client: `submissions-client.ts` replacement, `lib/photo-trail.ts`, `scripts/photo-trail.ts`, `AddImageButton.astro`, and removal of unused story-only components/scripts/styles. Keep the existing trail renderer and sequencing behavior.
- Verification: migration/RSVP integration tests, photo-pipeline and trail tests, retirement of obsolete story tests, and operations checks.
- Operations: `README.md`, `ops/README.md`, `ops/MODERATION.md`, and `ops/restore-drill.sh`; guest-upload storage is separate from family assets in `public/`.
- Planning overlap: the active `photo-normalization` change still describes legacy paths and mandatory thumbnails. This change preserves its implemented normalization/AVIF guarantees but supersedes those legacy clauses; reconcile overlapping artifacts before either change is synchronized/archived. Preserve unrelated in-progress work and the current RSVP changes.
