# Guest-photo clean baseline: implementation handoff

## Implemented

- Replaced `submissions` / `submission_photos` with `guest_photos`: random ID, unique invitation FK, unique canonical key, creation timestamp, and deterministic `(created_at, id)` index. This also removes the redundant child index and write-only child timestamp/identity/position fields.
- Replaced `/api/submissions` and nested story payloads with `/api/guest-photos`, singular multipart `photo`, and `{ inviteValid, mineId, photos }`. Public payloads contain no invitation identifiers, names, thumbnails, or copied attribution.
- Preserved one upload per invitation, image validation/normalization/privacy, WebP fallback, optional AVIF, caching, current trail renderer/sequence, starter images, and upload indicator.
- Canonical files are completed before publication. Exclusive directory reservation, owned cleanup, exact-attempt reconciliation after uncertain inserts, and distinct invite/key/ID constraint handling protect accepted content. Unique sibling partial filenames allow interrupted AVIF work to recover without deleting another writer's partial file.
- Removed the unused story viewer, rail, add-story flow, time helper, obsolete story suites, six `story_example` assets, and story-only theme/animation styles. Family public assets are preserved.
- Consolidated identity parsing into `invite-session.ts`; `/api/invite/me` reuses the resolver. Tracking routes retain their distinct write semantics. RSVP first/latest timestamps and invitation metrics remain intentional history.
- Removed unused direct `libsql` dependencies, DB-package `zod`, the unused catalog entry, Prisma ignore rule, and unused `CORS_ORIGIN` validation. Local secret files were not rewritten.
- Replaced migration history/metadata together with generated `0000_initial.sql`. The actual Drizzle migrator is wrapped with a legacy-table/hash compatibility guard, so old histories cannot silently skip the baseline or be reset. Relative SQLite URLs resolve from the same web root as runtime.
- Centralized isolated test database/server setup. Tests never reuse developer listeners or inherited DB/storage targets; private IPC, actual bound address, strict ports, and a per-instance nonce verify ownership. Each server has a private Vite cache.
- Fixed backup/restore target ambiguity, missing restore documentation, swallowed SQL errors, checksum false-success, missing canonical checks, and whitespace-unsafe backup pruning. Updated moderation, root setup/spec/manual notes, and rollback documentation.
- DB initialization now awaits FK setup and retries after transient initialization failure. Regression tests prove first-write FK enforcement and outage recovery.

## Existing state and deployment boundary

**The initial source cleanup did not reset or migrate any existing database.** The owner subsequently authorized a separate data-preserving migration of `packages/db/local.db` and `apps/web/var/photos` to restore the Memories uploader. That local migration is now complete; see the follow-up below. The old Playwright scratch database and all deployed environments remain untouched.

`db:migrate` still refuses unconverted legacy targets. No startup/reset/conversion behavior was added to normal application commands. Other populated environments need their own reviewed, explicitly authorized migration rather than copying the local procedure blindly.

Before source edits, the dirty working tree and in-progress migration were preserved in `/tmp/wedding-cleanup-before.EkbuGg/` (local safety snapshot, not a committed artifact). Unrelated UI work was not reverted. Other sessions continued editing unrelated slide/UI files during verification; their changes were left intact.

## Verification

Final focused command, from `apps/web`:

```sh
pnpm exec playwright test database-baseline.spec.ts db-client.spec.ts server-isolation.spec.ts restore-drill.spec.ts guest-photos-client.spec.ts guest-photo-smoke.spec.ts photo-publication.spec.ts photo-storage.spec.ts photo-pipeline.spec.ts photo-trail-selection.spec.ts photo-trail.spec.ts photo-upload-indicator.spec.ts magnetic-image-trail.spec.ts trail-animation.spec.ts trail-sequence.spec.ts rsvp-api.spec.ts rsvp.spec.ts --workers=2
```

**200 passed**, desktop Chromium and mobile Chrome, including real invite → RSVP → browser upload → public read → duplicate rejection → reload smoke tests. Evidence: `/tmp/wedding-cleanup-tests-final-focused.log`.

- `pnpm run check-types`: passed, zero errors/warnings (six existing hints).
- `pnpm run build`: passed.
- Focused non-mutating Oxlint and Oxfmt checks: passed. Generated Drizzle metadata is retained in generator formatting.
- `bash -n ops/backup.sh ops/restore-drill.sh`: passed.
- Real migrator repeat/no-op, migration drift, FK/unique/integrity, compatibility rejection, collision, uncertain-commit, partial-file, outage, ownership/isolation, concurrency, AVIF restart/flag, and strict backup/restore checks: covered by passing tests.
- Full repository suite was also run earlier: 312 passed, 3 skipped, 21 failed. Twenty failures were in existing families-reveal, scroll-fade selector, and welcome-gate/hero expectations outside this cleanup. The remaining added keyboard-test timing failure was corrected; it and the entire affected suite pass in the final run. The full repository suite is **not claimed green**.
- Existing `guest-greeting` spec validation errors (missing normative scenario for “Greeting text verbatim and escaped”) are unrelated and remain unchanged. All four affected specs and this change validate strictly.

## Specification synchronization

The six deltas were dry-merged into `/tmp/wedding-spec-preview.nloV7P/`. A repeat merge produced identical content. Removed scenario titles and both fully retired capability directories were checked absent; unrelated specs and retained motion requirements were checked unchanged.

The reviewed result was then applied to main specs: `guest-photos`, `guest-photo-trail`, `database-baseline`, and `interaction-motion`; removed `add-story-flow` and `story-rail-mocks`. Renames precede replacement of full scenario sets. Explicitly removed “One bad file fails the batch”, “Submissions API never cached”, “Pressing the add-story flow's controls”, and the obsolete empty-submission scenario. No Purpose-only retired files remain.

The installed archive CLI refuses implicit scenario deletion; do not force it with validation disabled. Main specs are already synchronized. When intentionally archiving this completed change, use `--skip-specs` after review rather than reapplying the deltas. This change remains unarchived for the owner to review.

`photo-normalization/tasks.md` records the overlap: its old path/thumbnail/multi-photo deltas must **not** be synchronized onto this baseline. Preserve its history and close with spec sync skipped when the remaining checks are accounted for.

## Still requires separate authorization / deployment

- Any deployed or other existing environment still needs its own explicit target/authorization, stopped writers, and matched rollback set. The authorized local preservation migration below does not authorize a production operation.
- Carry-forward `photo-normalization` task 6.2: verify the actual production `PHOTO_AVIF_ENABLED` and one real `PHOTO_STORAGE_DIR/guest-photos/<photo-id>/photo.webp` / `photo.avif` pair after deployment. This is pending, not satisfied by fixture tests.
- Retain task 6.3: verify `Vary: Accept` handling before configuring any shared image cache, especially Cloudflare rules.
- Local legacy auth secrets/configuration were left alone; remove them manually only after confirming no external process uses them. No secret values were included in the handoff.

## Authorized local preservation migration — 2026-09-16

The owner explicitly approved backing up and migrating `packages/db/local.db` plus `apps/web/var/photos` after the new collection API returned 503 on the legacy schema.

- Backup/recovery bundle: `/Users/ycm/Developer/oss/wedding-website-backups/2026-09-16T114738Z-guest-photos/`. `before/local.db` is the consistent pre-migration SQLite snapshot; `before/photos/` contains every original upload/variant/thumbnail. The bundle also contains the exact baseline SQL/journal, old rows/schema, photo mapping and checksums, a passing rehearsal, and the one-off migration script. Treat the bundle as private guest data.
- Rehearsed on a copy before changing the live local database. Stopped only the verified local Astro server, enabled foreign keys, and held an IMMEDIATE writer lock through the final backup/copy/DDL/verification. Migrated in-place without replacing the SQLite inode or deleting WAL/SHM; TablePro had an open connection and may need its schema refreshed.
- Preserved all **11 invitations**, **5 RSVP responses**, and **4 uploaded photos**, including tracking values, ownership, timestamps and exact canonical/AVIF bytes. Copied each photo to `guest-photos/<existing-random-photo-id>/photo.{webp,avif}`; left the old submission files intact for rollback. Retired party-size fields contained only default values; their original values remain in the backup.
- Compared the transformed schema with an actual freshly migrated reference, then adopted that baseline ledger in the same transaction. Integrity/FK checks passed, and the normal migration command is now a no-op on this local database.
- Restarted the same local development site on `http://localhost:4321/`. The photo API returns 200 with all four photos, every canonical URL responds 200, and confirmed RSVP count remains 5.
- Verified “Tambah punyamu” is visible and enabled for an existing eligible invitation, with no upload or RSVP submitted. Verification used a temporary browser cookie and blocked opened-metric writes; invitation/RSVP/tracking values were compared with the backup afterwards and remained identical. Removed the verification cookie afterward.
- Evidence: `verification.json`, `before/result.json`, `after/local.db`, and `memories-button-viewport.png` in the recovery bundle. No production migration or production AVIF verification was performed.
