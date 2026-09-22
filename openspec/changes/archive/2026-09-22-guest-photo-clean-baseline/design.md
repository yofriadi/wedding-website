## Context

The working tree already mounts `MagneticImageTrail` and `AddImageButton` in `apps/web/src/pages/index.astro`; `StoryViewer` is no longer the homepage presentation. `photo-storage.ts` already limits new uploads to one photo, while `scripts/photo-trail.ts` gates uploading on a resolved invite with no prior submission. However:

- `packages/db/src/schema/submissions.ts` still defines a parent `submissions` row and ordered `submission_photos` children.
- `/api/submissions` joins invite names, groups photo rows into `mine` and `wall.stories`, and produces per-submission thumbnails.
- `lib/photo-trail.ts` immediately flattens that grouping to photo URLs; the trail does not consume names or thumbnails.
- Storage still accepts legacy positions 0–2. Old story/intro/modal scripts, tests, and specifications remain.
- Migrations `0000`–`0005` create and later remove wish and party-size fields. The current invite and RSVP schemas already omit the retired fields; the uncommitted `0005` and associated tests must not be lost accidentally.

The owner confirms there are no users or guest records requiring preservation. This permits a coordinated schema/API/storage break and a new baseline; it does not authorize an unreviewed reset of a running environment. Changes are planned against the current working tree, including its in-progress trail and RSVP work.

## Goals / Non-Goals

**Goals:**

- Represent exactly one accepted guest photo per invite in one table.
- Expose a flat public collection with minimal caller-specific posting state.
- Preserve single-photo limits, public reads, invite-only writes, duplicate protection, image safety, and existing trail/upload interaction behavior.
- Publish only photos whose canonical files are complete, with ownership-safe cleanup and explicit handling of uncertain persistence outcomes.
- Generate a reproducible empty-database baseline and update affected tests and operations instructions.
- Remove the obsolete story presentation contract rather than retain an unused compatibility layer.

**Non-Goals:**

- Upgrading populated databases, backfilling old rows/files, keeping old URLs working, or supporting mixed old/new application versions.
- Multiple photos or repeated uploads per invite, guest editing/deletion, moderation UI, pagination, or new image infrastructure.
- Redesigning the magnetic animation, changing its 18 visible positions, tuning codec quality, or adding new photo sizes.
- Resetting the developer database, deployed database, or photo directories as part of artifact generation or routine migration.
- Changing RSVP behavior, invite metrics, unrelated UI motion, or historical archived change files.

## Decisions

### D1. A single `guest_photos` table

Create `packages/db/src/schema/guest-photos.ts`, export it from the schema barrel, and remove the submission tables from the schema.

| Column       | Definition                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `id`         | Non-null text primary key; random 12-character URL-safe ID generated independently of the invite ID |
| `invite_id`  | Non-null text, unique, FK to `invites.id`; retain the existing no-action deletion policy            |
| `key`        | Non-null unique text; canonical storage key                                                         |
| `created_at` | Non-null integer epoch milliseconds, assigned when the ready photo is published                     |

Add `guest_photos_created_at_id_idx` on `(created_at, id)` for deterministic newest-first reads. `UNIQUE(invite_id)` remains the authoritative post-once constraint, not a client flag or preflight SELECT. Do not copy invite names into this table. Keep current local foreign-key enforcement and prove it in fresh-database tests; remove stale comments claiming the existing FK setup is documentation-only where touched.

The other application tables are preserved exactly as currently modeled:

- `invites`: `id`, `display_name`, `created_at`, nullable `seen_at`/`opened_at`, and non-null `seen_count`/`opened_count` defaulting to zero.
- `rsvps`: `invite_id` primary key/FK, `attending`, `responded_at`, `updated_at`, and `rsvps_attending_idx`.

There is no `wish_text`, `max_party_size`, `party_size`, `submission_id`, or photo `position` in the baseline.

**Alternatives:** Keeping two tables would preserve grouping that the product no longer has. Putting the photo key on `invites` would mix optional guest content with invitation identity and moderation. Renaming only the tables while retaining story grouping would leave most unnecessary complexity intact.

### D2. Replace the collection endpoint and payload together

Use `GET` and `POST /api/guest-photos`, implemented in `apps/web/src/pages/api/guest-photos/index.ts`. Retain `GET /api/photos/[...key]` solely for validated public file delivery. Remove `/api/submissions`; no redirect, alias, dual-write, or legacy payload parser is required on a fresh setup.

The successful collection response is:

```ts
interface GuestPhoto {
  id: string;
  photoUrl: string;
  createdAt: number;
}
interface GuestPhotosPayload {
  inviteValid: boolean;
  mineId: string | null;
  photos: GuestPhoto[];
}
```

`photos` contains every persisted guest photo exactly once, including the caller's, ordered by `created_at DESC, id DESC`. `mineId` is selected by the server using the resolved cookie; it is not an invite ID. No invite IDs, names, storage keys as a separate field, `firstName`, wish fields, nested stories, or thumbnail URLs are serialized. The internal query may select `invite_id` to compute `mineId`; it does not need an attribution join.

Missing, malformed, and stale cookies receive `200`, `inviteValid: false`, `mineId: null`, and the public collection. A resolved invite receives `inviteValid: true` and its photo ID if any. An actual resolution/query failure receives `503`, not a successful empty collection. All collection responses, including POST errors, are `Cache-Control: no-store`.

POST authenticates before parsing. A missing/malformed/unknown invite gets the existing uniform empty `404`; a database outage gets the existing unavailable response. The multipart contract is exactly one file field named `photo`:

| Outcome                                                                                                   | Response                                |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Complete accepted photo                                                                                   | `201` with the `GuestPhoto` object      |
| Existing photo for the invite, including a concurrent winner                                              | `409 { "error": "already_posted" }`     |
| No photo field                                                                                            | `400 { "error": "empty_photo" }`        |
| More than one `photo` entry                                                                               | `400 { "error": "too_many_photos" }`    |
| Upload exceeds 10 * 1024 * 1024 bytes                                                                     | `400 { "error": "photo_too_large" }`    |
| Unsupported magic or undecodable image                                                                    | `400 { "error": "invalid_photo_type" }` |
| Non-multipart, malformed multipart, non-file `photo`, or unknown fields such as legacy `photos`/wish text | `400 { "error": "invalid_body" }`       |
| Storage/database failure other than the invite uniqueness conflict                                        | `503`                                   |

Retain the application's same-origin mutation protections and cookie-only identity. An optional duplicate lookup can save normalization work, but the insert constraint decides races. Do not classify primary-key, storage-key, foreign-key, or arbitrary database errors as `already_posted`.

**Alternative:** Keeping `/api/submissions` would reduce renames but preserve a misleading concept in every client and test. There are no external consumers or users requiring that compromise. A collection under `/api/photos` would collide conceptually with the existing catch-all binary route; the separate `/api/guest-photos` route is explicit.

### D3. Publish the database row after the canonical file is ready

Do not copy the old claim-first pipeline into the flattened model. A claim-first row can be read while its file is missing and needs pending-state or compensating deletion. Instead:

1. Resolve invite identity and validate the entire multipart request.
2. Normalize the one photo in memory before any row or file write.
3. Generate a photo ID and exclusively reserve its directory under `PHOTO_STORAGE_DIR/guest-photos/`. Ensure the shared parent exists, then reserve the leaf with a separate non-recursive `mkdir(leaf)`; `EEXIST` is a collision, not permission to write into it. The existing recursive `mkdir` inside `photo-storage.ts::writeFileAtomic` is not an exclusive reservation and cannot establish attempt ownership. Retry a fresh ID a bounded number of times, then fail as unavailable. Record ownership only after successful exclusive creation.
4. Atomically write the canonical file within that owned directory.
5. Insert the `guest_photos` row with its final key and timestamp. This is the publication boundary and the concurrent post-once decision.
6. After confirmed persistence, queue the optional AVIF variant without awaiting its encode and return `201`. HTTP response or optional queue problems after persistence must never trigger deletion of the accepted photo.

If validation fails, nothing was written. If storage fails, remove only the directory this attempt owns. If insertion definitively fails on `guest_photos.invite_id`, remove only the losing attempt's directory and return `409`. Other definitive insert failures clean up the attempt and return `503`. No cleanup path deletes by invite ID or touches a different attempt's files. Collision handling never overwrites or removes an existing namespace.

An insert exception can have an uncertain outcome, especially if a remote libSQL connection is later used. Before deleting files for an uncertain result, reconcile by this attempt's generated ID/key: a matching persisted row is accepted, not rolled back; confirmed absence permits cleanup; inability to establish the outcome leaves files intact, logs the condition, and returns unavailable. A later collection read resolves whether the invite already posted. This is preferable to breaking a possibly accepted immutable URL.

SQLite and the filesystem cannot be committed atomically together. A process kill after file creation but before publication can leave an unreferenced directory; it cannot leave a published row pointing to an unfinished file under this ordering. Cleanup failures must be logged and covered by an offline reconciliation procedure. Reconciliation runs only with writers/variant generation stopped, compares owned directories to table keys, and never treats an in-flight write as an orphan. Do not add automatic age-based deletion to request handling.

**Alternatives:** A pending row/status column or holding a database transaction across image I/O would complicate a one-photo model and increase lock duration. Publishing last accepts recoverable orphan files rather than visible incomplete rows or permanently claimed upload slots. Response loss is handled by the unique invite constraint and a collection refresh, not a second idempotency table.

### D4. Photo-scoped storage without thumbnails

Use exactly these stored artifacts for a photo:

```text
guest-photos/<photo-id>/photo.webp  # required canonical; stored in guest_photos.key
guest-photos/<photo-id>/photo.avif  # optional derived variant
```

The public canonical URL is `/api/photos/guest-photos/<photo-id>/photo.webp`. Restrict accepted storage/read keys to this namespace and the existing 12-character URL-safe ID alphabet. Reject old `submissions/` paths, arbitrary positions, thumbnails, absolute paths, traversal, and `.part` files. Keep resolved-root containment checks. Atomic writes continue to use a sibling temporary file renamed into place, with failed-write cleanup; the upload directory reservation prevents one request from overwriting another request's canonical.

Preserve the implemented image pipeline: allowed input types JPEG/PNG/WebP/AVIF by content, at most 10 MiB, decoder/pixel limit, orientation application, metadata stripping, longest edge at most 2048 with no upscaling, and WebP quality 80. Only an already optimal, correctly oriented, metadata-free WebP within the size cap and no larger than the server re-encode can pass through. JPEG/PNG/AVIF always become WebP. Delete thumbnail constants, encoding/writing, URL fields, and queued thumbnail work after checking consumers; the trail already uses canonical URLs.

Keep the bounded, deduplicated AVIF queue, feature flag, non-fatal failure/drop logging, and GET-triggered retry for missing variants. Require explicit nonzero `image/avif` support, not `*/*`; serve canonical WebP while a variant is absent and to non-AVIF clients. Preserve `Vary: Accept`, immutable one-year success caching, uncached missing/malformed responses, and the documented warning against caches that ignore `Vary`. No direct `.avif` sidecar URL is needed in the collection.

**Alternatives:** Keeping `submissions/<id>/0.webp` would avoid a key change but preserve fake position/submission semantics. Keeping thumbnails would waste upload/queue work for files no current renderer requests. New trail-sized variants or different quality constants are a separate performance decision.

Rename `apps/web/src/lib/submissions.ts` to `apps/web/src/lib/guest-photos.ts`, including `generateSubmissionId` → `generatePhotoId` and `SUBMISSION_ID_LENGTH` → `PHOTO_ID_LENGTH`, and update every import. Keep the existing cryptographic randomness and ID alphabet; do not retain a submissions-named shim.

### D5. Preserve the existing trail and upload interaction

Replace `submissions-client.ts` with `guest-photos-client.ts`, including required payload types, a shared in-flight/successful-read cache, explicit invalidation, and a `guest-photos:posted` event. Retry transient failures rather than caching them forever; no legacy optional-payload compatibility remains.

`selectTrailImages` consumes `photos` directly and never mutates the cached payload. Deduplicate nonempty sources defensively and preserve the full guest pool. The trail shows exactly those sources: each photo once, smaller collections leave the remaining display positions empty, and an empty collection shows nothing — no starter fillers or repeats. Eighteen is not a collection or rotation limit. Feed the caller's `mineId` URL as priority to the existing `setImages`/`TrailSequence` behavior; do not rewrite the renderer or orbit timings.

The picker is enabled only after a successful response proves `inviteValid && mineId === null`. Anonymous, stale-cookie, and unresolved/error states cannot open it. Existing posters do not regain eligibility; show non-actionable posted feedback or gallery-refresh recovery, never a fresh chooser. Activation opens the native single-file picker directly, including keyboard/Safari user activation; there is no intro, modal, preview step, or separate Share button. Preserve client pre-validation, the current upload indicator, inline error/status region, focus handling, and disabled/busy guards.

After `201` or `409`, mark the request committed before refreshing. Invalidate the shared loader, notify listeners, refresh the gallery, and report full visual success only after the caller's photo is present and decodable. If refresh/decode fails, keep a retry action that performs collection/image refresh only; never POST the accepted file again. After a transport error with unknown commit outcome, refresh state before retrying an upload; if the caller's row exists, use the committed path. Keep generation/disposal guards so stale reads, focus events, or detached controls cannot override current state or start duplicate work.

Retain the current reduced-motion/static trail behavior and the existing upload control's accessibility behavior; replacing data contracts must not reintroduce hidden motion or change layout.

### D6. Retire story-only code and requirements, not unrelated behavior

Trace consumers before deletion. Expected obsolete candidates are `StoryViewer.astro`, `AddStoryTile.astro`, `AddStoryFlow.astro`, `scripts/story-viewer-element.ts`, `scripts/guest-rail.ts`, and `scripts/add-story-flow.ts`, plus story-only mocks, intro flags/events, styles, fixtures, and tests. Keep any shared helper/style still used by another component. Do not delete family public assets as part of database cleanup.

Remove the six retired demo assets `apps/web/public/story_example_{1,2,3}.{webp,avif}` and the orphaned starter pair `apps/web/public/awal-perkenalan-2.{webp,avif}` after confirming no live consumer remains. Preserve the family photos still referenced by `TimelineScroll` and `ZoomParallax`. If a non-story consumer is discovered, resolve it explicitly before removing that asset rather than breaking it.

Include `apps/web/tests/mock-tiles-verify.spec.ts` in the obsolete-mock test inventory. Retain `apps/web/tests/trail-animation.spec.ts` but update its `**/api/submissions` intercept and payload to the new collection and verify the intercept is actually exercised; animation assertions must not pass merely because they never reached the obsolete route.

Delta specs remove the old add-story and mock capabilities' requirements, remove story-only portions of interaction-motion, and replace the guest-photo API/storage requirements. Unrelated interaction-motion requirements (FAQ, RSVP, loading, map) remain intact. Reframe useful old tests as trail/API regressions instead of preserving a dead story runtime solely to make them pass.

### D7. Replace migration history as one generated baseline

After the schema is final, remove the old SQL chain and its associated journal/snapshots as a unit and run the existing package generator with an explicit name:

```sh
pnpm --filter @wedding-website/db run db:generate --name=initial
```

Expected committed output is `0000_initial.sql`, `meta/0000_snapshot.json`, and `meta/_journal.json` with one entry. Do not concatenate old SQL or hand-maintain snapshots. The SQL creates the final three application tables and their indexes/FKs directly; it contains no create-then-drop history and no data conversion.

Use an explicitly provided absolute `file:` URL for verification, since the runtime and Drizzle config resolve relative paths from different working directories:

```sh
DATABASE_URL=file:/absolute/disposable-test-dir/baseline.db pnpm --filter @wedding-website/db run db:migrate
```

This is an example target, not a command to run literally against a deployed database. Apply twice with the real migrator, verify the second run is a no-op, inspect `sqlite_schema`, indexes, `foreign_key_list`, `foreign_key_check`, and `integrity_check`, and confirm the migration journal is populated correctly. Generate again from unchanged schema and verify no new migration is produced. SQL-only test helpers that execute files without the Drizzle journal do not prove idempotency, so add a dedicated real-migrator test.

The current `rsvp-api.spec.ts` intentionally seeds old `party_size`/`max_party_size` columns before `0005`; replace that preservation test with fresh-baseline seeding and current RSVP behavior assertions. Keep first-response timestamps, upsert behavior, and the confirmed-invitation count contract unchanged. Update photo/SSR integration bootstraps to the baseline rather than hard-coded old DDL or filenames.

**Alternative:** An incremental `0006` is appropriate once data must survive, but here it would retain obsolete history and conversion logic without a user to benefit. Rewriting only SQL while leaving old snapshots/journal would break future generation and migration, so metadata replacement is mandatory.

### D8. Operations are part of the schema change

Update `README.md` and `ops/README.md` with fresh-install-only semantics, explicit database/storage targets, the new key layout, and the unchanged encoding/cache warnings. `backup.sh` already copies the whole storage tree and excludes `.part`; verify rather than rewrite it unnecessarily.

Change `ops/restore-drill.sh` to validate `invites`, `rsvps`, and `guest_photos`. A failed SQL query must fail the drill, not produce matching `n/a` values and pass. Test missing tables and valid restored snapshots; compare live counts using a quiescent fixture/environment because a running live database can legitimately advance beyond the backup. Preserve the integrity and photo-file checks.

Rewrite moderation examples to look up one `guest_photos` row and remove that row and only its generated directory. Stop writers/AVIF jobs for manual filesystem removal to avoid a queued variant recreating the directory. Deleting the row releases the invite's upload slot, as today; do not imply deleting an invite is a safe ban mechanism with dependent RSVP/photo FKs. Document that previously cached files and backups are not remotely revoked by a local deletion. No moderation API is added.

### D9. Reconcile overlapping planning work explicitly

The active `photo-normalization` change is mostly implemented but still contains deltas for `/api/submissions`, three-photo batches, position paths, and mandatory thumbnails. This proposal is based on the current main specs, which do not yet include that change's added normalization/AVIF requirements. The new guest-photos delta carries forward those implemented safety guarantees in the new model.

Before synchronizing or archiving either change, record that this change supersedes the overlapping legacy contracts. Retain or transfer any outstanding normalization verification; do not mark unchecked work complete just to resolve the overlap. The older delta must not be synchronized unchanged before or after this one: reconcile its operations with the resulting base, or close the superseded change without reapplying its spec delta after its remaining work is accounted for. Preserve unrelated active changes and archived history. Main specs and the other change directories are not modified during this proposal-generation step.

Spec-sync disposition (including the plan-reviewer corrections):

- The repository's agent-driven sync preserves unmentioned scenarios. Explicitly remove `guest-photos` / `Upload failure is atomic-ish` / **One bad file fails the batch**, `guest-photos` / the cache requirement / **Submissions API never cached**, and `interaction-motion` / `Press scales are transition-driven` / **Pressing the add-story flow's controls**. The affected MODIFIED blocks declare their complete final scenario sets; do not keep the superseded scenarios alongside them.
- Apply the guest-photo requirement renames before their MODIFIED blocks: **Guest photo API never cached; photo files cacheable**, **One photo per invite**, and **Upload requires one photo** are the final titles. Replace **Empty submission rejected** with **Empty upload rejected** rather than keeping both.
- After applying all removals, delete the fully retired main capability files/directories `openspec/specs/add-story-flow/` and `openspec/specs/story-rail-mocks/`; no Purpose-only files remain. Repeated sync treats their absence as already retired, never recreates them. Keep this change's deltas and archive history. Replace the main `interaction-motion` Purpose with the updated scope supplied in its delta.
- Transfer the still-unchecked `photo-normalization` task **6.2** to the release handoff using the configured `PHOTO_STORAGE_DIR/guest-photos/<photo-id>/` and `photo.webp`/`photo.avif` names, not `/srv/wedding/photos/submissions/<id>/`. Keep it pending until a real deployment is explicitly authorized and checked; a temporary fixture does not prove production configuration. Retain task **6.3**'s conditional `Vary: Accept`/Cloudflare warning.
- Before actual sync, review a dry-merged main-spec result in disposable scratch space: no removed scenario title or retired requirement title survives, the two retired capability directories are absent, the updated Purpose is present, unrelated requirements remain, validation succeeds, and a second merge makes no changes. Do not modify the live main specs merely to perform this planning check.

## Risks / Trade-offs

- **Existing databases are incompatible with the new history** → Require an empty target; document replacement separately, stop the app first, and never attempt an in-place migration from old journals.
- **A reset can erase developer/remote data despite the no-users assumption** → Verify the exact target and obtain explicit confirmation before any non-test reset; move/backup the old DB and upload tree together when needed. No broad delete or startup auto-reset.
- **Filesystem and database commits are not atomic** → Publish the row last, use exclusive attempt ownership, reconcile uncertain insert results, log cleanup failures, and use offline orphan reconciliation after a crash.
- **Parallel uploads may both spend encoding/I/O work** → Accept bounded extra work for one photo; `UNIQUE(invite_id)` picks the winner and losing files are removed. Do not hold a DB write lock through encoding.
- **ID/path collision cleanup could damage another request** → Exclusive leaf reservation and per-attempt ownership are required; inject collision tests rather than relying solely on low random collision probability.
- **Old clients and photo URLs stop working** → Deploy the schema, server, and client together before users exist; no compatibility promise is made.
- **A future multiple-photo feature would need schema changes** → Keep the present product rule explicit; add a real migration when that requirement exists rather than keeping unused grouping now.
- **Removing tests can hide preserved behavior** → Transfer validation, auth, caching, concurrency, retry, reduced-motion, and lifecycle checks before retiring story-specific tests.
- **An out-of-order spec archive could restore old contracts** → Reconcile the active normalization change as D9 requires and validate deltas against the base at sync time.

## Migration Plan

1. Review the proposal and overlapping active work. Confirm the one-photo-per-invite rule remains the product decision. Implementation changes source/artifacts and disposable test fixtures first, not existing environments.
2. Implement the new schema, endpoint, storage pipeline, client adapter, and tests as a coordinated change; retire dead story consumers and update operations instructions.
3. Regenerate the initial SQL/snapshot/journal together and prove a fresh migration plus idempotent re-run on a new temporary SQLite file. Run schema-drift checks, focused tests, type checks, and the production build.
4. For a fresh deployment, choose explicit absolute database and upload paths, apply the baseline with `db:migrate`, then start the matching application build. An empty migrated database and empty guest collection are valid; the trail renders no images until guests post photos.
5. For an already initialized disposable environment, separately identify and confirm the target. Stop Node and background image work; preserve or move the database together with its SQLite sidecars and the guest-upload tree; create the replacement empty database/storage target; migrate; restart; verify invite creation, RSVP, upload, public display, and restore checks. Do not touch public family assets. A remote database reset requires provider-specific instructions and separate authorization, not local file commands.
6. Rollback before users arrive means stop the app and restore the matching prior code, database/journal, and photo tree together, or recreate a disposable database using the prior revision's migration history. Never run old code on the new baseline or restore only half of DB/storage. If real users/data arrive before rollout, stop: this clean-reset plan must be replaced by a data-preserving migration plan.

## Open Questions

No product decision blocks implementation: the plan retains one photo per invite, public photo viewing, and invitation-only posting. The concrete non-test reset target and authorization are intentionally deferred to deployment; implementation and verification must not choose them implicitly. The active normalization change's remaining verification and spec-sync disposition must be recorded before either change is archived, per D9.
