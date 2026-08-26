# Design: invite-only-personalization

## Context

Phase 1 (implemented, see root `SPEC.md`) ships invite links: `POST /api/admin/:token/invites` creates a row in `invites`, `GET /:id` bumps seen-metrics, sets client-readable cookie `ww_invite_id` (30d, `SameSite=Lax`, never overwritten), and redirects to `/`. Nothing consumes the cookie.

**Deployment target changed** (locked after research): a self-hosted Tencent CVM — Standard S5.MEDIUM4 (2 vCPU Cascade Lake, 4 GiB RAM), Singapore region, Ubuntu Server 26.04 LTS, valid through Oct 18, 2026 (wedding: Oct 10; site release: ~Sep 19). Key platform facts: public IPv4 assigned by default; egress billed pay-per-traffic at $0.081/GB (no free quota); system disk 20–50 GiB expandable online; expiry → stopped → 15-day recycle-bin grace → destroyed (~Nov 2); security groups default-drop inbound; no ICP needed (Singapore); outbound SMTP port 25 blocked (465/587 open); free Anti-DDoS Basic (2 Gbps). `TestimonialMarquee.astro` is ambient decoration (opacity 0.1, pointer-events none) and stays as-is. Guest submissions are the separate `guest-submissions` change.

## Goals / Non-Goals

**Goals**: invite holders see their name at first paint on the loading overlay, on every visit; a reusable cookie-identity contract; honest story teaser with no dead UI; the simplest possible self-hosted deployment the couple can own during wedding season.

**Non-Goals**: guest submissions (see `guest-submissions`); RSVP; households; cookie healing; Cloudflare proxy fronting (simple first); moderation tooling.

## Decisions

### D1 — Deployment: bare VM + Caddy + node standalone + local SQLite

`@astrojs/node` standalone becomes the only adapter (drop the `LOCAL_DEV` Cloudflare switch in `astro.config.mjs`; dev = prod). Caddy on Ubuntu terminates TLS automatically and reverse-proxies the node process (systemd/pm2). SQLite is a local file (`DATABASE_URL=file:...`; no Turso). Rationale: fixed cost (VM already owned), Singapore is the right region for a mostly-Indonesia/SEA guest list (~10–30ms), the whole app state becomes one file plus (later) one photos directory, and dev/prod divergence (former L4) disappears. Alchemy/`packages/infra` deploy path is retired for this site. Egress is metered, so billing must be pay-per-traffic with a 30–50 Mbps cap (bursty wedding traffic; est. $1–3 total).

### D2 — Greeting: server-rendered, no fetch machinery (review 2, B1 — dissolved)

On Workers, personalization had to be a client fetch (CDN would otherwise cache one guest's name for everyone), which created the fetch-vs-overlay race and the 600ms floor. On a VM there is no shared cache layer: the homepage renders per request on node. Therefore: `index.astro` reads `ww_invite_id` in frontmatter, looks up `invites` (local SQLite, sub-millisecond), and renders `displayName` into the overlay greeting element inline. The name is in the first paint — warm-cache visits are identical to cold ones. The greeting element sits above the shimmer phrases; both centered as a flex group; empty placeholder for anonymous requests renders nothing (public markup indistinguishable from today's). **No client fetch, no `/api/invite/me` call for the greeting, no overlay floor.**

### D2a — `no-store` on the homepage

Every `/` response carries `Cache-Control: no-store` (not just personalized ones). Rationale: if a shared cache (e.g. a future Cloudflare proxy) is ever added, a cached personalized response cannot leak across guests. Cost is nil at wedding scale.

### D3 — Identity endpoint kept as the reusable contract

`GET /api/invite/me` ships per the `invite-session` spec (uniform 404 for missing/malformed/unknown cookie, `no-store`, read-only, no CORS). The greeting doesn't consume it (D2 renders inline), but `guest-submissions`' client flow and future RSVP do. One contract, one place.

### D3a — Greeting text

`displayName` renders verbatim (whatever the couple POSTed at invite creation). Astro template auto-escapes; stored markup is inert.

### D4 — Story rail teaser

Demo `StoryViewer` tiles remain for everyone, unchanged. The "Add Story" input tile is deleted from the DOM (shipped dead UI: file input that alerts "to be implemented"). Teaser tiles: couple supplies up to three static text-image assets in `apps/web/public/teasers/` (e.g. `story-teaser-1.webp`), rendered as plain non-interactive `<img>` (112×200, matching rail tiles) — NOT `StoryViewer` instances. Invitees see the same teaser until `guest-submissions` ships. No fetches, no cookie reads.

### D5 — What is NOT in this change

Wishes, wish posting, photo upload, the add-story flow, and any guest-content surface are planned together in `guest-submissions` (single submission flow; invite-only visibility; post-once per invite; no author attribution; `TestimonialMarquee` → `WishMarquee` rename as the real surface; old `WishMarquee.astro` deleted). This change provides its identity contract (D3) and its deployment substrate (D1).

## Risks / Limitations

- **L1 — Stale cookie**: never-overwrite means a regenerated invite can't heal an old cookie; accepted.
- **L2 — 30d cookie vs Oct 10 wedding**: returning guests become anonymous unless they re-click their link; accepted (re-click is the healing path).
- **L3 — Shared devices**: one cookie = one identity per browser; accepted with households deferred.
- **L4 — Single-box availability**: one VM, one region, no redundancy. Accepted: the site is disposable, its critical window is short, and the failure blast radius is a broken wedding site, not a business. Mitigation: nightly backups (guest-submissions close-out) + 15-day post-expiry recycle-bin grace.
- **L5 — Egress metering**: $0.081/GB with no free quota; pay-per-traffic + 30–50 Mbps cap keeps bursts fast and total cost ~$1–3; monitor during the wedding weekend.
- **L6 — VM expiry**: instance stops Oct 18; data intact in recycle bin ~15 days (~Nov 2); then destroyed. DB backup ships in THIS change (task 1.8, from day one); guest-submissions extends it to photos and owns the final archive drill before expiry.
- **L7 — e2e harness status**: `dev:bare` NOW exists in `apps/web/package.json` (`astro dev`) and Playwright invokes it from `apps/web` — the earlier "broken harness" claim was fixed externally. e2e remains optional/out of scope for this change, but the harness is usable.
- **L8 — SMTP port 25 blocked** on the VM (irrelevant now; matters only if a future RSVP feature sends email — use 465/587 providers).
