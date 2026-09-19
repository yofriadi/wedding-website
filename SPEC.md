# Invitation and database contract

Current implementation summary. Detailed requirements are in `openspec/specs/`; coordinated cleanup decisions are in `openspec/changes/guest-photo-clean-baseline/`.

## Invitations

- Share URL: `GET /<id>`, where the ID is a cryptographically random 12-character URL-safe string (`A-Z`, `a-z`, `0-9`, `-`, `_`). The route is `apps/web/src/pages/[id].ts`, not `/i/:id`.
- A known invite increments `seen_count`, sets `seen_at`, binds **or rebinds** `ww_invite_id` to that invite, and redirects to `/`. Existing/stale cookies must not mask a newly opened invitation.
- Invalid/unknown links redirect without creating a record or setting an unverified cookie. Tracking is best-effort; database failures must not break the homepage.
- Cookie: client-readable, `Path=/`, `SameSite=Lax`, `Secure` in production, default lifetime 30 days (`INVITE_COOKIE_DAYS`). Possession of a valid invitation identifies the upload/RSVP owner; it is not proof of real-world identity.
- `POST /api/invite/opened` updates `opened_at`/`opened_count`. Homepage rendering and `GET /api/invite/me` are read-only.
- Missing, malformed, and unknown cookies receive the same empty `404` from private APIs. Infrastructure errors are `503`, not identity misses. Public photo collection reads instead serve anonymous posting state.
- Personalized HTML, identity APIs, redirects, RSVP responses, and photo collection/upload responses use `Cache-Control: no-store`.

## Admin

`GET` and `POST /api/admin/:token/invites` require `INVITE_ADMIN_TOKEN` (at least 32 characters). Wrong/unconfigured tokens return `404`. POST accepts a trimmed nonempty `displayName`, at most 120 characters, and returns `201 { id, sharePath: "/<id>" }`. GET reports invitation tracking and RSVP attendance. Do not expose the path token in logs or public links; call it only over HTTPS in production.

## Current tables

- `invites`: `id`, `display_name`, `created_at`, nullable `seen_at`/`opened_at`, zero-default `seen_count`/`opened_count`.
- `rsvps`: primary-key/FK `invite_id`, boolean `attending`, first `responded_at`, latest `updated_at`; index on attendance. Upserts preserve the first response timestamp. Public count means attending invitations, not party headcount.
- `guest_photos`: `id`, unique FK `invite_id`, unique canonical `key`, `created_at`; index `(created_at, id)`. One accepted photo per invitation. No parent submission, ordering position, wish, party-size, thumbnail, or copied author fields.

The application enables SQLite foreign keys. Dependencies use no-action deletion: operators must not delete invitation rows underneath RSVP/photo records.

## Guest photos

`GET /api/guest-photos` returns `{ inviteValid, mineId, photos: [{ id, photoUrl, createdAt }] }`. It includes all photos once in descending timestamp/ID order, with no public invitation IDs or names.

`POST /api/guest-photos` resolves the cookie before body parsing and accepts exactly one multipart file named `photo`, at most 10 MiB. JPEG/PNG/WebP/AVIF are validated by content and decoder. Every canonical is safe WebP, orientation-corrected, dimension-capped and metadata-free; optional AVIF is generated afterwards. Files are complete before the row is published. Duplicate invitation ownership returns `409`; other failures cannot delete another upload's files.

Stored paths are `guest-photos/<photo-id>/photo.webp` and optional `photo.avif`, served publicly by `/api/photos/<key>` with immutable caching and `Vary: Accept`. The magnetic trail uses family starter images only as presentation fallbacks; they are not database records.

## Migration and operations

Generate changes with `pnpm run db:generate`; apply committed history with `pnpm run db:migrate`. `db:push` is not a release command.

The current initial migration is fresh-install-only. Existing legacy environments require an explicitly authorized replacement or a data-preserving migration plan, never an automatic reset. See `README.md` and `ops/README.md` for explicit targets, matched rollback, and backup verification. No IP addresses, user agents, or referrers are stored for invitation tracking.
