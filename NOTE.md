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

Open the returned share path in a browser. The welcome gate should show the escaped guest name. Opening another valid invitation rebinds the cookie to that invitation — with one exception: a **group** link keeps a cookie that already maps to one of its own members (re-set with a fresh `Max-Age`). Use the actual returned ID, not an invented short fixture ID.

Group invitations add one creation call and one claim call:

```sh
# Create a group invite (maxMembers must be an integer 2-50).
curl -X POST http://localhost:4322/api/admin/manual-test-token-not-for-production-123/invites \
  -H 'content-type: application/json' -H 'origin: http://localhost:4322' \
  -d '{"displayName":"The Smith Family","type":"group","maxMembers":3}'
# Returns {"id":"<group id>","sharePath":"/<group id>","type":"group","maxMembers":3}.
```

Open that share path in two separate browser profiles. Both get the group cookie and can browse freely — nothing is consumed. Each visitor following a group link below capacity sees an entry claim gate after the loading screen phrases:

- Enter a name (e.g. "Alex") and tap "Mulai": `POST /api/invite/claim` returns `201`, rebinds that browser's cookie to the new member id, fades out the claim gate, reveals the welcome gate personalized with "Alex", unhides the RSVP confirm form, and unlocks the photo upload CTA without any page reload.
- `/api/invite/me` reports `kind` — `"group"` before a claim, `"member"` after — plus `group: { maxMembers, claimedCount }` for a group cookie.
- A group cookie cannot RSVP or upload: `POST /api/rsvp` and `POST /api/guest-photos` both return `409 {"error":"claim_required"}`, while their `GET`s stay valid (`{"attending":null}` / `{"inviteValid":true,"mineId":null}`).
- Re-tapping the group link keeps a claimed member's identity (sticky).
- Once `claimedCount` reaches `maxMembers` the link still works: visitors browse normally and see a read-only "group is at capacity" state instead of the claim form.
- The admin `GET` lists members as their own top-level entries and nests a breakdown (`claimedCount`, `attendingCount`, `declinedCount`, `photoCount`, `members[]`) under the group.

- `/api/invite/me` returns the resolved display name and identity `kind` without changing visit metrics.
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
