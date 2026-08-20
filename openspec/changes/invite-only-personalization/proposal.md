# Proposal: invite-only-personalization

## Why

Phase 1 shipped invite links that set a `ww_invite_id` cookie, but nothing reads it — guests get an identical anonymous experience. This change personalizes the site for invite holders and re-targets deployment from Cloudflare Workers to a self-hosted Tencent CVM (Singapore, Ubuntu 26.04, node adapter + Caddy): personalization becomes plain server-side rendering per request, so invitees see their name at first paint with no client fetch machinery.

## What Changes

- **Deployment to self-hosted VM**: `@astrojs/node` (already in repo) becomes the only adapter; Caddy (auto-TLS) fronts the node server; SQLite is a local file (no Turso); the Alchemy/infra deploy path is retired for this site.
- **Guest greeting on loading overlay**: the server reads the invite cookie at request time and renders the invite's `displayName` into the overlay HTML, above the shimmer phrases, centered as a group. Public visitors get identical markup with an empty greeting. No client fetch, no race, no minimum display floor — the name is present at first paint on every visit, warm cache included.
- **New endpoint `GET /api/invite/me`**: the reusable identity contract (cookie → `{ displayName }`, uniform 404, `no-store`). The greeting itself does not use it (SSR instead); it exists for `guest-submissions` and future features.
- **Story rail teaser**: demo tiles stay for everyone; the "Add Story" input tile is removed from the DOM entirely (its file input currently alerts "to be implemented"); up to three couple-supplied text-image tiles frame the rail as invite-only.
- **Guest submissions extracted**: wishes + photos become one section feature, planned thoroughly in `guest-submissions`. Decisions locked for that change: single add-story flow, invite-only visibility, post-once per invite, no author attribution (W4), `TestimonialMarquee` renamed to `WishMarquee` as the real wish surface, old `WishMarquee.astro` deleted.

## Non-goals

- **Guest submissions** — its own change: `guest-submissions`.
- **RSVP** — not in scope; `invite-session` is the pattern for it.
- **Households/group invites** — one invite = one identity.
- **Cookie healing** — never-overwrite retained; documented limitation.
- **Fixing `playwright.config.ts` `dev:bare`** — separate concern.
- **Cloudflare proxy fronting** — deliberately not in v1 ("simple first"); may be added later as pure infra, but must honor the `no-store` homepage header.

## Capabilities

### New Capabilities

- `invite-session`: Cookie-as-identity lookup layer — `/api/invite/me` contract, uniform 404, no-store.
- `guest-greeting`: Server-rendered overlay greeting — placement, verbatim escaped text, first-paint semantics, no-store homepage.
- `story-teaser`: Rail teaser + add-tile removal until guest submissions ships.

### Modified Capabilities

None — `openspec/specs/` has no existing specs.

## Impact

- **Code**: `apps/web/src/pages/index.astro` (greeting element + server cookie read, add-tile removal, teaser tiles), `astro.config.mjs` (drop the Cloudflare/LOCAL_DEV adapter switch), new `apps/web/src/pages/api/invite/me.ts`. No DB changes.
- **Infra**: VM setup (security group 80/443, pay-per-traffic billing with 30–50 Mbps cap, disk ≥20 GiB), Caddy + domain/TLS, systemd/pm2 process management, `DATABASE_URL=file:...`.
- **Risk**: single-box availability (accepted — site is disposable, nightly backups are `guest-submissions` close-out, and the VM has a 15-day recycle-bin grace after expiry); egress metered at $0.081/GB (bounded: wedding-scale traffic ≈ $1–3 estimated for the whole season).
