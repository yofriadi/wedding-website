# Isolated development walkthrough

Run from the repository root. This walkthrough deliberately uses a **new temporary database and upload directory**, never `packages/db/local.db` or existing guest uploads.

```sh
sandbox="$(mktemp -d /tmp/wedding-manual.XXXXXX)"
export DATABASE_URL="file:$sandbox/manual.sqlite"
export PHOTO_STORAGE_DIR="$sandbox/photos"
# Test-only token; never use this value in a deployed environment.
export INVITE_ADMIN_TOKEN=manual-test-token-not-for-production-123
mkdir "$PHOTO_STORAGE_DIR"
pnpm run db:migrate
pnpm --filter web run dev --port 4322
```

In a second terminal, use the same test token and `http://localhost:4322`:

```sh
curl -X POST http://localhost:4322/api/admin/manual-test-token-not-for-production-123/invites \
  -H 'content-type: application/json' -H 'origin: http://localhost:4322' \
  -d '{"displayName":"Test & Guest"}'
# Returns {"id":"<generated 12-character id>","sharePath":"/<same id>"}.
```

Open the returned share path in a browser. The welcome gate should show the escaped guest name. Opening another valid invitation rebinds the cookie to that invitation. Use the actual returned ID, not an invented short fixture ID.

- `/api/invite/me` returns the resolved display name without changing visit metrics.
- Confirm attendance and inspect `/api/rsvp/count`: repeat confirmation is an upsert, not a new row.
- Use “Tambah punyamu” to select one image. Success requires the stored photo to load into the trail. A second upload is rejected.
- `/api/guest-photos` is public, flat, and has no guest names/invitation IDs.
- A valid photo URL works without a cookie. It returns WebP unless a ready AVIF variant is explicitly accepted. Check `Cache-Control` and `Vary: Accept`.
- Missing/malformed/stale invite cookies produce an empty `404` from private APIs; a public photo read remains public.

Automated equivalents:

```sh
pnpm run check-types
pnpm --filter web exec playwright test database-baseline.spec.ts rsvp-api.spec.ts photo-pipeline.spec.ts photo-trail.spec.ts
pnpm run build
```

Tests create their own temporary state and do not reuse the server above. When finished, stop only the manual server you started before handling its `$sandbox`. Do not clear `invites` in an existing database: it has dependent RSVP/photo foreign keys. See `ops/README.md` for separately authorized replacement and `ops/MODERATION.md` for reviewed photo removal.
