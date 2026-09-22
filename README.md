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

- `GET /<12-character-invite-id>` records a visit, binds/rebinds `ww_invite_id`, and redirects to `/`. **Sticky exception:** a _group_ link keeps a cookie that already maps to one of its own members, re-setting it with a fresh `Max-Age` instead of rebinding; `GET /<group-id>?fresh=1` releases back to the group identity (creates no rows and consumes no slot; the group's seen-metrics still bump as for any link visit). The release is honoured only for a real visit to our own page (`Sec-Fetch-Site: same-origin`/`none` + `Sec-Fetch-Dest: document`) and only while the group has an open slot — at capacity it is refused, because releasing then could never be undone.
- `POST /api/invite/claim` mints one member slot under a group invite and rebinds the cookie to it. Opening a group link is free and unlimited — only a claim consumes a slot, capped atomically at `maxMembers`.
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
