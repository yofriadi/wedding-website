# Shareable Invite Links (Guest Tracking)

## Goal

Create a shareable invitation URL with a generated opaque ID that:

- Identifies a guest (for future RSVP and other features).
- Sets a client-readable cookie on first visit, then removes the ID from the address bar by redirecting to `/`.
- Stores minimal tracking (last seen timestamp + seen count) without collecting IP, user-agent, or referrer.

This spec defines the initial data model and endpoints to support:

- Generating invite links via a manual (curl/Postman) admin endpoint.
- Resolving an invite ID from a shared URL into a persistent cookie.
- Recording basic open/seen metrics for the invite.

## Non-Goals (for this phase)

- RSVP UI and submission flows (only ensure the invite ID is available for later).
- Bot/link-preview detection (any hit to the share URL counts as a "seen").
- Revocation, rotation, expiration.
- UTM/referrer analytics.
- Per-visit event timelines.
- Authentication for admin endpoints via headers/sessions (admin access is via a non-obvious URL).

## Glossary

- Invite: A record representing one guest. (Group/household RSVP is deferred.)
- Invite ID: The opaque public identifier embedded in the share URL.

## Product Decisions (Locked)

- URL format: `GET /i/<id>`
- Behavior: set cookie (only if absent), increment seen metrics, then redirect to `/` with no banner.
- Cookie persistence: 30 days by default; configurable.
- Cookie is client-readable (NOT `HttpOnly`).
- Cookie overwrite: NO. If cookie already exists, do not replace it.
- ID type: short opaque random string, length 12.
- Guests will not manually type IDs.
- Admin creation: a non-obvious URL (token in path), no Authorization header.
- Invite destination: always `/`.

## UX / UI

### `/i/<id>`

- Never renders UI.
- Always responds with a redirect to `/`.

### `/`

- In this phase, page remains as-is.
- Future: can greet the guest using the cookie-derived invite ID (server-side lookup) and display `displayName`.

## Security & Privacy

### Privacy

- Do not store: IP address, user-agent, referrer, UTM parameters.
- Store only:
  - `displayName` (for future personalization)
  - `seenAt` and `seenCount`

### Admin Endpoint Exposure

The admin endpoint is protected only by an unguessable path token. Tradeoffs:

- Pros: simplest workflow (curl/Postman).
- Cons: token appears in request URL (can be logged by intermediaries).

Mitigations:

- Token MUST be long random (>= 32 chars, URL-safe).
- Only call the endpoint over HTTPS.
- Do not share the token.

## Data Model (Drizzle / SQLite)

Create a single table for now.

### Table: `invites`

- `id` (TEXT, primary key)
  - Public invite ID
  - Generated as a 12-character URL-safe random string (nanoid-style)
- `display_name` (TEXT, required)
  - Guest-facing name; will be shown on page later
  - Stored as provided; server should trim whitespace
- `created_at` (INTEGER, required)
  - Unix timestamp in milliseconds
- `seen_at` (INTEGER, nullable)
  - Unix timestamp in milliseconds
- `seen_count` (INTEGER, required)
  - Default 0

Constraints / indexes:

- Primary key on `id`.
- Optional future index on `seen_at` if needed for sorting.

Notes:

- "Group/household" is deferred; schema should be easy to extend later via a nullable `group_id` or a separate `invite_groups` table.

## Cookie Contract

- Name: `ww_invite_id`
- Value: the invite `id` (12 chars)
- Lifetime:
  - Default: 30 days
  - Configurable via env var `INVITE_COOKIE_DAYS`
- Scope:
  - `Path=/`
  - `SameSite=Lax`
  - `Secure` in production; allow non-secure in local dev (`http://localhost`)
- Accessibility:
  - Client-readable (NOT `HttpOnly`)

Overwrite behavior:

- If `ww_invite_id` is already set, do not overwrite it.

## Endpoints (Astro SSR)

Astro is configured with `output: "server"` and runs on the `@astrojs/node`
standalone adapter (behind a Caddy reverse proxy with auto-TLS in prod; the same
adapter serves local dev).

### 1) Resolve Invite Link

Route:

- `GET /i/:id`

Responsibilities:

- Validate `id` format (length 12; URL-safe charset).
  - If invalid format: still redirect to `/`.
- Increment invite metrics:
  - `seen_count = seen_count + 1`
  - `seen_at = now()`
  - If `id` not found: do nothing (no insert) and still redirect.
- Cookie:
  - If `ww_invite_id` cookie is absent AND the invite exists, set it to `:id` with configured TTL.
  - If already present, do not overwrite.
- Response: `302` redirect to `/`.

### 2) Create Invite (Admin)

Route:

- `POST /api/admin/:token/invites`
  - `:token` must match env `INVITE_ADMIN_TOKEN`.

Request:

- JSON body:
  - `displayName`: string (required)

Behavior:

- If token mismatch: respond `404` (do not reveal the endpoint exists).
- Validate `displayName`:
  - trim
  - non-empty
  - recommended max length: 120 chars (server-side)
- Create invite:
  - Generate `id` (12 chars)
  - Insert row with `created_at = now()`, `seen_count = 0`, `seen_at = null`
  - Handle collisions by retrying generation on primary-key conflict.

Response:

- `201` JSON:
  - `id`
  - `sharePath`: `/i/<id>`

Example (curl):

```bash
curl -X POST \
  -H 'content-type: application/json' \
  'https://yourdomain.com/api/admin/<INVITE_ADMIN_TOKEN>/invites' \
  -d '{"displayName":"Sarah"}'
```

## Environment Variables

Add to server env schema (`packages/env/src/server.ts`) and deployment bindings:

- `INVITE_ADMIN_TOKEN` (string, recommended)
  - If unset, the admin create endpoint is effectively disabled (always returns 404).
- `INVITE_COOKIE_DAYS` (string/number, optional)
  - Default 30

## Implementation Notes (Repo-Specific)

### Code locations

- DB schema:
  - `packages/db/src/schema/invites.ts`
  - `packages/db/src/schema/index.ts` should export the table(s)
- Web routes:
  - `apps/web/src/pages/i/[id].ts`
  - `apps/web/src/pages/api/admin/[token]/invites.ts`

### Database access

- Import `db` from `@wedding-website/db`.
- Ensure Drizzle schema exports are wired so `drizzle({ client, schema })` has `invites`.

### Migrations

- Generate/apply via:
  - `pnpm db:generate`
  - `pnpm db:push`

## Future Extension (RSVP)

This feature is intentionally structured to support RSVP later:

- RSVP pages/endpoints can read `ww_invite_id` (client-readable cookie).
- Server-side RSVP submission should trust the cookie only as an identifier, not as proof of real-world identity.
- A later schema can add group/household support and RSVP responses linked by `invite_id`.
