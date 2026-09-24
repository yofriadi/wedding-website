# wedding-website

[![docker-image](https://github.com/yofriadi/wedding-website/actions/workflows/docker-image.yml/badge.svg)](https://github.com/yofriadi/wedding-website/actions/workflows/docker-image.yml)
Licensed under the [MIT license](LICENSE).

Astro + TypeScript + Tailwind, deployed with the standalone Node adapter. SQLite is accessed through Drizzle and libSQL. The application stores invitations, RSVP responses, and one optional guest photo per invitation.

## Media: placeholders vs. private

The public repository ships **placeholder** images (and a short placeholder video) for all personal photos — the memories collage, family photos, the proposal clip, and the soundtrack. The hero photo, event (akad/resepsi) images, and venue map images are the real files. Placeholder filenames and dimensions match the originals exactly, so the layout is unaffected.

Your real media stays **out of git**, preserved in gitignored `originals/private-media/` (same relative paths). To deploy the personal version:

```sh
tools/restore-private-media.sh   # overlays real media over the placeholders
pnpm run build                   # or the Docker build — disk state wins, not git
```

Docker builds read from disk, not git: on a VPS, copy `originals/private-media/` over the clone first (same layout), then `docker compose up -d --build`. The CI image on GHCR always contains placeholders. The soundtrack is never committed (copyright); drop any licensed `*.mp3` at its referenced path — `tools/restore-private-media.sh` restores it too.

### Generated responsive variants

`apps/web/public/generated/` holds the AVIF + WebP resolution variants (390 / 768 / 1280 px) and the ~32 px blurred placeholders for every photographic master the markup references. It is **gitignored and never committed**: a variant of a real photo is itself private media, so the repository ships the masters as placeholders and derives from whatever is on disk.

`pnpm run build` regenerates it first, through `apps/web`'s `prebuild`. **`astro dev` runs no `prebuild`**, so after a fresh clone — or after overlaying real media — run it once by hand:

```sh
tools/restore-private-media.sh          # real masters into public/ (private deploy only)
pnpm --filter web run media:variants    # regenerate public/generated/ from them
pnpm run dev
```

The generator is idempotent (it skips outputs newer than their master, so a second run reports `nothing to do`), never upscales, never re-emits a width the master already fills, and **fails the build** on any of: `apps/web/public/` not existing at all — the failure a developer hits most often, which is a `cd` into `apps/web/` before running the script, and produces `public/ not found: …` naming the expected path; a base name outside `[a-z0-9_-]`; a master the markup names being missing; a master present in only one of AVIF/WebP; the two formats of one base disagreeing on intrinsic width; a component referencing a base the generator's explicit list omits; a listed base matching the excluded `wedding_photo*` hero family or naming a subdirectory; a base listed twice; one of the markup sources the cross-check reads being absent (a sparse checkout or a rename); or an unreadable master. A placeholder over 4 KB also fails the build, and that cap is re-checked over every placeholder on disk — including ones restored from the Turbo cache that never pass through the encoder. Each is a guest-facing 404, a mis-declared `w` descriptor, or a silent budget increase otherwise. A generated **variant** over 200 KB is a warning naming every file, not a failure: that ceiling bounds a property of the couple's photos, and failing a deployment over one busy real photo is worse than shipping it.

Changing an encode setting invalidates every output: the generator writes `generated/manifest.json` fingerprinting `PIPELINE_VERSION`, the `sharp`/libvips/aom/libwebp versions, `SETTINGS`, the width ladder and the placeholder geometry, and treats a mismatch as stale. It deliberately does **not** fingerprint `BASES` — no surviving output's bytes depend on the list — nor `src/lib/image-encode.ts`, whose constants `SETTINGS` mirrors by hand. Two consequences worth knowing. The fingerprint travels with `public/generated/**` through the Turbo cache, so it cannot be restored out of step with the outputs it describes — co-location is the reason for that, and the reason it is a plain filename rather than a dotfile. (A dotfile would additionally risk falling outside that glob, but the glob's dotfile behaviour is untested and is not what the choice rests on.) And it is **copied into `dist/client/` and served** at `/generated/manifest.json`, like everything else under `public/`; that is deliberate rather than an oversight, since the base names already appear in the delivered `srcset`s and encode settings are not secrets, but it does mean build configuration is publicly readable. Without it a quality edit is a silent no-op. The unchanged bytes then sit in **two** places: re-archived under the new cache key in `.turbo/cache/`, and — the one that matters — still in the working tree. So clearing the Turbo cache does not help; `rm -rf apps/web/public/generated` is the remedy. Note also that `generated/` is gitignored and therefore contributes **zero** Turbo inputs (a `--dry=json` run reports 152 inputs for `web#build`, none of them under `generated/`), so two different working-tree states hash identically: a cache hit can restore an older archive over a newer hand-run and nothing detects it, because the restored manifest matches the restored outputs. `tools/restore-private-media.sh --undo` does this for you, since the variants it leaves behind are derivatives of the real media. Because it reads whatever is _present_, CI derives variants from the placeholders and a restored machine derives them from the real photos — one command, both legs produce the same file set, and nothing private is ever staged. Turborepo caches the directory through `turbo.json`'s package-relative `public/generated/**` build output, which is what restores the _working-tree_ copy on a cache hit; `dist/client/generated/` was already covered by `dist/**`.

> **Do not enable Turbo Remote Cache without reading this.** `.gitignore` keeps
> these derivatives out of git because a variant of a real photo is itself private
> media — but `.gitignore` does not reach the Turbo cache. Setting `TURBO_API` /
> `TURBO_TOKEN` / `TURBO_TEAM` would upload up to 84 derivatives of the couple's
> photos to a third-party cache, with no guard and no test watching for it. No
> remote cache is configured today. Dropping the `public/generated/**` output entry
> is _not_ the fix: without it a cache hit restores `dist/client/generated` but
> leaves the working tree empty, which breaks `astro dev` and the generator's mtime
> comparison. See `openspec/changes/resilient-media-delivery/follow-ups.md` §5.

## Development

```sh
pnpm install
# Copy only if .env does not already exist; never overwrite your local secrets.
cp -n apps/web/.env.example apps/web/.env
```

### Database baseline

The committed migration creates only `invites`, `rsvps`, and `guest_photos`, plus Drizzle's migration ledger. It is a **fresh-install baseline**, not an upgrade from the former submissions/party-size schema. `db:migrate` checks existing migration history and refuses incompatible targets without changing their data.

On a genuinely new checkout with no existing database:

```sh
pnpm run db:migrate
pnpm run dev
```

The example URL is `file:../../packages/db/local.db`. Relative file paths resolve from `apps/web` in the application and migration tooling. Prefer absolute paths for all operational commands.

**Already have a database?** Do not delete it, its `-wal`/`-shm` files, or its uploads to make migration succeed. Select a new empty database and separate storage directory, or follow the separately authorized replacement procedure in [ops/README.md](ops/README.md). If records must survive, stop and use a data-preserving migration plan. The old `0005` attendance-only migration is superseded by the new baseline; it has not been applied to your existing local database by this cleanup.

A safe isolated development session, leaving existing data alone:

```sh
sandbox="$(mktemp -d /tmp/wedding-dev.XXXXXX)"
export DATABASE_URL="file:$sandbox/app.sqlite"
export PHOTO_STORAGE_DIR="$sandbox/photos"
mkdir "$PHOTO_STORAGE_DIR"
pnpm run db:migrate
pnpm --filter web run dev --port 4322
# Keep the sandbox while needed. Stop its server before disposing of it.
```

Use `db:generate` after schema edits and commit SQL, snapshot, and journal together. `db:push` is only for explicitly disposable development databases; it bypasses migration history and is not a deployment command.

### Current contracts

- `GET /<12-character-invite-id>` records a visit, binds/rebinds `ww_invite_id`, and redirects to `/`. **Sticky exception:** a _group_ link keeps a cookie that already maps to one of its own members, re-setting it with a fresh `Max-Age` instead of rebinding. Seen-metrics always bump on the link id, whatever the cookie holds.
- `POST /api/invite/claim` mints one member slot under a group invite and rebinds the cookie to it. Opening a group link is free and unlimited — only a claim consumes a slot, capped atomically at `maxMembers`. For group links below capacity, claiming occurs up front at an entry claim gate before the welcome gate, transitioning seamlessly to the welcome gate, RSVP form, and photo upload chooser with zero page reloads.
- `GET /api/invite/me` resolves identity without changing metrics, returning `{ displayName, kind }` plus `group: { maxMembers, claimedCount }` for group cookies.
- `POST /api/invite/opened` records opening the invitation.
- `GET` / `POST /api/rsvp` read/upsert boolean attendance. Response timestamps are retained; the public count is attending invitations, not party headcount — so a group contributes one count per attending member. An unclaimed group cookie POSTs to `409 { "error": "claim_required" }` and reads as `{ attending: null }`.
- `GET /api/guest-photos` returns `{ inviteValid, mineId, photos: [{ id, photoUrl, createdAt }] }` for everyone. Names and invitation IDs are not public photo metadata.
- `POST /api/guest-photos` accepts exactly one multipart `photo` file for a resolved invitation, once only. `409` means `already_posted` or (for an unclaimed group cookie) `claim_required` — branch on the code, not the status.
- Canonical files are private-storage `guest-photos/<photo-id>/photo.webp`, with an optional `photo.avif`. `/api/photos/<key>` serves public immutable content, with AVIF negotiated through `Vary: Accept`.

[NOTE.md](NOTE.md) provides an isolated manual walkthrough. [SPEC.md](SPEC.md) summarizes the current invitation contract; detailed capability specs live in `openspec/specs/`.

## Tests

```sh
pnpm run check-types
pnpm --filter web exec playwright test
pnpm run build
```

Playwright always starts its own migrated temporary database, photo storage, and server on a free port. It never reuses a running developer server or an inherited database URL. API suites use the same isolated setup helper. The baseline suite uses the real migrator, checks constraints/integrity, verifies repeat migration is a no-op, and guards against legacy database resets.

## Deployment

**Docker on a VPS (recommended):** see [DEPLOY.md](DEPLOY.md) — one container, data in a named volume, migrations applied on start.

### Manual (bare metal)

The application and both operations scripts must receive the **same explicit targets**. For a fresh installation, after selecting those targets:

```sh
export DATABASE_URL=file:/srv/wedding/local.db
export PHOTO_STORAGE_DIR=/srv/wedding/photos
export BACKUP_DEST=/mnt/backup/wedding
# These paths are examples, not permission to replace existing data.
pnpm run db:migrate
pnpm --filter web run build
# From apps/web, start the matching build using your service manager:
# NODE_ENV=production HOST=127.0.0.1 PORT=4321 node dist/server/entry.mjs
```

Apply migrations before starting the matching application build. No startup code resets the database or upload directory. See [ops/README.md](ops/README.md) for backups, strict restore checks, replacement/rollback boundaries, AVIF configuration, and caching restrictions.

## Project structure

- `apps/web/`: pages, API routes, components, photo processing, browser tests
- `packages/db/`: current schema, generated migration, guarded migration runner
- `packages/env/`: validated server environment
- `ops/`: backup, restore verification, moderation
- `openspec/`: capability specifications and coordinated change plans

## Commands

- `pnpm run dev`, `pnpm run build`, `pnpm run check-types`
- `pnpm run db:migrate`, `pnpm run db:generate`, `pnpm run db:studio`
- `pnpm run check`: lint and format **with edits**; use `pnpm exec oxlint` and `pnpm exec oxfmt --check <paths>` for read-only verification
- `pnpm run prepare`: install Git hooks
