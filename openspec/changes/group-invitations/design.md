# Design: group-invitations

## Context

The site currently supports only **individual invitations**:

1. Admin creates an invite via `POST /api/admin/[token]/invites` (`displayName` → 12-char id).
2. Guest opens `/{id}` (`apps/web/src/pages/[id].ts`): bumps `seen_at`/`seen_count`, sets `ww_invite_id={id}` (sliding `Max-Age` from `INVITE_COOKIE_DAYS`), 302 → `/`.
3. The cookie is the only identity channel: SSR greeting + RSVP controls (`index.astro` runs its own inline invite query — it does **not** use `resolveInvite`), `POST /api/invite/opened`, `GET`/`POST /api/rsvp`, `GET`/`POST /api/guest-photos`. The API endpoints resolve the cookie through `resolveInvite()` in `apps/web/src/lib/invite-session.ts`; the photo surface additionally runs a client-side script (`src/scripts/photo-trail.ts`) that branches on upload response status codes.

Persistence is Drizzle + libsql/SQLite (`packages/db`): `invites` (12-char text PK), `rsvps` (`invite_id` PK/FK), `guest_photos` (`invite_id` unique/FK). The migration directory is a single generated baseline guarded by hash comparison in `packages/db/scripts/migrate.mjs`; `ops/README.md` documents the separately authorized baseline-replacement procedure. Tests are Playwright specs in `apps/web/tests/` that boot a real server and seed via raw SQL.

**New requirement:** group invitations. One link, many people; each person who acts gets an independent RSVP and photo slot; total slots capped by an admin-set quota (`maxMembers`, 2–50).

**Data decision (recorded by the owner, 2026-09-28):** `packages/db/local.db` exists on disk and was preserved as private guest data on 2026-09-16 (11 invitations, 5 RSVP responses, 4 uploaded photos — bundle recorded in `openspec/changes/guest-photo-clean-baseline/handoff.md`). `README.md` forbids deleting it _unauthorized_. The owner has now confirmed **that data is disposable** and authorized the replacement procedure in `ops/README.md`: the local DB is deleted and recreated from the regenerated baseline. No data-conversion step, no additive `0001` migration — the original greenfield framing holds for implementation. See D5.

## Goals / Non-Goals

**Goals:**

- One shareable group link; each acting visitor gets a fully independent identity (own name, RSVP, photo, metrics).
- Hard quota: never more than `maxMembers` member slots, even under concurrent claims.
- Zero redesign of `rsvps` / `guest_photos` — per-member behavior falls out of existing constraints.
- Link forwarding is free: browsing never consumes slots; only an explicit claim does.
- No identity dead-ends: a shared browser can reach a fresh group identity through the `?fresh=1` release path **while the parent group still has an open slot**, and member cookies keep sliding expiry. At capacity the release is deliberately withheld on both the client and the server: it is one-way, so releasing when no slot could be re-claimed could only strand the member (see the D2 capacity gate and the risk register).
- Minimal endpoint surface change: existing RSVP/photo/tracking flows work unchanged once a member identity exists.

**Non-Goals:**

- Admin UI/dashboard — the token-gated JSON API is the admin surface.
- Server-side member management (rename, unclaim a _slot_, revoke, transfer quota) — visible via admin list; DB mutations are future work. The client-side cookie release (`?fresh=1`) IS in scope because it touches zero rows and unblocks the primary family use case.
- Strong per-person authentication — cookie identity is the existing (accepted) model; quota bounds abuse.
- Group-level RSVP/photo (a response "for the whole family") — members always act individually.
- Automatic reset of existing dev databases — the guarded migrator refuses the regenerated baseline; replacement is the documented manual procedure.

## Decisions

### D1. Parent-child rows in `invites` — not separate group tables

Each group **member is a real child row in `invites`** (`parent_id` → group). Evaluated alternatives:

| Approach                                               | RSVP/photo tables                                                                                                                               | Endpoint churn                                                                  | Verdict                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| **Parent-child invites** (chosen)                      | **Zero changes** — member id is an `invites.id`, so `rsvps` PK and `guest_photos` unique constraint give one-RSVP/one-photo per member for free | Tiny — `resolveInvite` gains a `kind`; all existing per-invite logic just works | ✅                               |
| Separate `groups` + `group_members` tables             | `rsvps`/`guest_photos` need a second FK or polymorphic owner column; uniqueness becomes conditional                                             | Every endpoint branches on identity type                                        | ❌ redesign cost, invariant risk |
| Group id + per-member session rows (no member invites) | Same polymorphic-owner problem                                                                                                                  | Same                                                                            | ❌                               |

Schema changes (`packages/db/src/schema/invites.ts`; adds `check`, `index`, `sql`, `AnySQLiteColumn` to the imports):

```ts
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at").notNull(),
    seenAt: integer("seen_at"),
    seenCount: integer("seen_count").notNull().default(0),
    openedAt: integer("opened_at"),
    openedCount: integer("opened_count").notNull().default(0),
    parentId: text("parent_id").references((): AnySQLiteColumn => invites.id), // self-FK needs the lazy callback
    type: text("type").notNull().default("individual"), // "individual" | "group"
    maxMembers: integer("max_members"), // groups only
  },
  (table) => [
    index("invites_parent_id_idx").on(table.parentId),
    check("invites_type_chk", sql`${table.type} IN ('individual','group')`),
    check(
      "invites_group_shape_chk",
      sql`(${table.type} = 'group') = (${table.maxMembers} IS NOT NULL)`,
    ),
    check(
      "invites_member_shape_chk",
      sql`${table.parentId} IS NULL OR ${table.type} = 'individual'`,
    ),
    check(
      "invites_max_members_range_chk",
      sql`${table.maxMembers} IS NULL OR ${table.maxMembers} BETWEEN 2 AND 50`,
    ),
  ],
);
```

Row taxonomy (derived, not stored): **group** = `type='group'`; **member** = `type='individual' AND parent_id IS NOT NULL`; **standalone individual** = `type='individual' AND parent_id IS NULL`. "Member" is deliberately not a third `type` value: members behave identically to individuals everywhere except claim/admin, and the CHECK constraints pin the shape.

Group vs member fields: a group carries `displayName` (e.g. "The Smith Family") + `maxMembers`; a member carries its own `displayName` and NULL `maxMembers`. **No `claimedCount` column** — it is always derived as `COUNT(*) WHERE parent_id = ?`, so it can never drift. The self-FK (`PRAGMA foreign_keys=ON`, default `ON DELETE NO ACTION`) means a group row cannot be deleted while members exist — a mechanical backstop to the ops rule against deleting invitations.

### D2. Slots are claimed on explicit action via name prompt — not on link open

The three options from the task, analyzed:

- **Option A (claim on `GET /{id}`):** link shared in a WhatsApp group of 15 people where `maxMembers=10` → 10 slots burn instantly on read-only opens; 5 people (possibly the actual invitees) are locked out of RSVPing. Incognito re-opens or link previews burn more. ❌ quota exhaustion by accident.
- **Option B — name-prompt claim (chosen):** browsing is free and unlimited; a slot is consumed only when a visitor explicitly enters their name. Accidental clicks and link forwarding cost nothing. The display-name prompt doubles as slot confirmation, so members get real names for the greeting and admin breakdown. ✅
- **Option C (provisional session on visit, formalize on action):** needs provisional-row TTL/GC, a second cookie, and "upgrade" logic in every endpoint — complexity to solve a problem Option B doesn't have. ❌

Chosen lifecycle:

1. `GET /{groupId}` — unchanged behavior: seen-metrics on the group row, `Set-Cookie: ww_invite_id={groupId}`, redirect. Unlimited visitors.
2. The RSVP surface learns `kind` server-side (`index.astro`'s inline query is extended with `type`/`parentId`/`maxMembers` + a member count) and the photo surface learns it client-side from `GET /api/invite/me` (already spec'd to return `kind` + `group` quota state — no change to the identity-minimal `GET /api/guest-photos` payload). Group-cookie visitors see a **name prompt** ("Claim your spot") while slots remain, or a **read-only capacity state** when full.
3. Visitor submits their name → `POST /api/invite/claim { displayName }` → server atomically mints the member row (D3) and **rebinds the cookie** to the member id in the same response, with **the full cookie attribute set from `[id].ts`** — `httpOnly: false` (load-bearing: client gates on `document.cookie`), `path: "/"`, `sameSite: "lax"`, `secure` in production, `maxAge` from `INVITE_COOKIE_DAYS`.
4. From then on the visitor holds an ordinary individual-grade identity: RSVP, photo upload, greeting, and open-tracking need **no group awareness at all**.

Why a dedicated claim endpoint instead of baking auto-claim into `POST /api/rsvp` / `POST /api/guest-photos`: (a) RSVP's strict body is `{ attending }` and photo's is multipart — grafting a name prompt onto both duplicates logic; (b) auto-claim without a name yields anonymous members that degrade the greeting and admin list; (c) one endpoint = one quota guard = one place to get the concurrency right. The mutation endpoints instead **reject group cookies** with `409 claim_required`, which tells the client to run the claim flow.

**Capacity-full behavior:** visitor N+1 still browses everything (link, greeting, photos wall, RSVP count). Blocked actions return explicit errors — claim → `409 group_full`; RSVP/photo with group cookie → `409 claim_required`; the client renders the read-only "group is at capacity" state from the group quota state. Read endpoints stay graceful: `GET /api/rsvp` with a group cookie → `200 { attending: null }`; `GET /api/guest-photos` → `inviteValid: true, mineId: null`.

**Client must branch on the 409 error code, not the status.** `photo-trail.ts` today treats _any_ 409 as success (`already_posted` is currently the only 409). It must narrow that branch to `already_posted` by reading the JSON error body; `claim_required` routes to the claim prompt, `group_full` to the capacity state, and `committed` is never set for either.

**Why `409` and not the uniform `404` for group cookies on mutations:** the uniform-404 rule exists so _anonymous_ callers can't probe endpoint existence. A group-cookie holder is an authenticated, valid identity — everything the 409 discloses (`kind`, quota state) is already handed to the same caller by `GET /api/invite/me`. Missing/malformed/unknown cookies still get the bare `404`, and identity is still resolved before any body parsing (endpoint-invisibility preserved).

### D3. The claim insert is a single atomic statement — the only quota guard

SQLite serializes all writes (locally via the single shared connection, remotely via the libSQL server), so a single conditional statement cannot race:

```sql
INSERT INTO invites (id, display_name, created_at, parent_id, type)
SELECT ?, ?, ?, ?, 'individual'
WHERE (SELECT COUNT(*) FROM invites i WHERE i.parent_id = ?)
    < (SELECT max_members FROM invites g WHERE g.id = ?)
RETURNING id, display_name;
```

- **Execution API:** this repo's Drizzle SQLite driver (drizzle-orm 0.45.2) has **no `db.execute`** — issue the statement via Drizzle's parameterized template (`db.all(sql`…`)`) or `db.$client.execute({ sql, args })`. Never interpolate `displayName` into a SQL string. Both subqueries bind the _same_ `group.id` (6 bind parameters total) so a refactor cannot split them.
- **Empty `RETURNING`:** normally means quota full ⇒ `409 group_full`. It also occurs if the group row vanished between resolution and insert (no delete endpoint exists, and the self-FK blocks deleting a group _with_ members — but an empty group could in principle be removed by an operator). The handler re-checks group existence on empty RETURNING: group gone ⇒ `503` (retryable, operator-visible in logs); group present ⇒ `409 group_full`. Deliberate, documented, never silent.
- **Storage failures** (`SQLITE_BUSY`, outages) surface as `503` — matching the RSVP spec's "Database outage is not a 404" — and MUST NOT be reported as `group_full`. `group_full` is reserved for a successfully executed statement that inserted zero rows.
- **Id-collision retry:** the claim id uses the existing 12-char generator with a collision-retry loop, but the classifier MUST be precise (`/UNIQUE constraint failed: invites\.id/i` or the libsql `SQLITE_CONSTRAINT_PRIMARYKEY`/`_UNIQUE` codes) — the existing admin loop's four-substring classifier (`"UNIQUE" || "constraint" || "PRIMARYKEY" || "SQLITE_CONSTRAINT"`) would swallow the new CHECK/FK failures into 5 pointless retries and an opaque 500 (the correct precedent is `guest-photo-upload.ts`'s exact regex + `isDefinitiveConstraint` split). Any non-collision constraint error fails fast. Each retry re-executes the whole conditional `INSERT … SELECT … WHERE`, never a bare `INSERT`.

Concurrent claims serialize on the write lock; the N+1th observes the committed count and inserts zero rows. There is no count-based CHECK in SQLite, so **this statement is the entire guard** — two corollaries: (1) it must never degrade into read-then-write across statements outside a transaction; (2) no other code path may insert rows with `parent_id` set (admin POST rejects `parentId`; covered by test). The concurrency test in the tasks is load-bearing: a read-then-write implementation would still fail it, because the two `await`s interleave on the event loop even on one connection.

Alternatives considered: `BEGIN IMMEDIATE` + `SELECT COUNT` + `INSERT` (correct on our single shared client, but two statements to keep correct forever, and worse under any future multi-connection setup); a separate `slots` counter column with `UPDATE … WHERE claimed < max` (denormalized drift risk, and still needs the member insert to be atomic with it).

### D4. Sticky member cookie on revisit — re-set, not suppressed — plus a `?fresh=1` release path

`GET /{id}` currently always rebinds the cookie to the link id, sliding the 30-day `Max-Age` on every tap ("explicit identity statement supersedes a stale cookie"). For groups that rule is wrong: a member who re-taps the link in chat would be silently demoted from their claimed identity to the anonymous group identity, appearing to "lose" their RSVP.

New rule in `[id].ts`: resolve the link id's invite; if it is a group **and** the current cookie maps to a member invite whose `parent_id` equals this group's id → **re-set the cookie with the same member id and a fresh `Max-Age`** (identity preserved, sliding expiry preserved — strictly simpler than suppressing the header, and avoids the "identity expires 30 days after claim" regression that a suppress-the-header rule would create). All other cases rebind to the link id as today. Seen-metrics always bump on the group row (the link id) regardless of cookie state. The metrics `UPDATE … RETURNING` and the degraded-path existence `SELECT` both gain `type` so the sticky check works even when the metrics write failed.

**Release path:** `GET /{groupId}?fresh=1` skips the sticky rule and rebinds to the group id — a cookie-only "Not you? Claim your own spot" escape for shared browsers (the primary use case is families sharing devices). It creates no rows and consumes no slot, and the member row is untouched (its RSVP/photo survive, and any OTHER device still holding that member cookie still resolves as that member — this browser loses the member id, so a re-claim from it mints a NEW member row consuming another slot; a future release of _slots_ is an admin-side concern). Without this, the sticky rule + idempotent re-claim leaves the second person in a household with no in-spec path to a slot. Chosen over a `POST … { action: "release" }` variant because it reuses the existing link semantics (metrics bump, no-store redirect, same Set-Cookie path) with one query-param branch — no new endpoint.

**Amended by review rounds 2–3.** A state-changing GET turns out to be exempt from _both_ CSRF protections this app relies on: Astro's `checkOrigin` skips safe methods outright, and `SameSite=Lax` still _sends_ the cookie on cross-site top-level navigations. So any site knowing a group id could force-navigate a member to `/{groupId}?fresh=1` and irreversibly downgrade them. Two mitigations were added without changing the endpoint shape:

- **Server:** the release is honoured only when `Sec-Fetch-Site` is `same-origin` or `none` (deliberately not `same-site` — on a shared domain another tenant is same-site but cross-origin) and `Sec-Fetch-Dest` is `document`. Absent headers pass, so older browsers, `curl`, and the manual walkthrough keep working. A refused release still 302s and falls back to the sticky rule.
- **Client:** the release renders as a `<button>` whose target lives in a `data-release-href`, navigated via `location.assign` on the confirmed activation — not an `<a href>`. With a static href the two-step is bypassed by middle-click/`auxclick`, the context menu, iOS long-press, drag-to-bookmarks, Copy Link Address, and scripting-disabled taps, all of which reach the endpoint with gate-passing Sec-Fetch metadata.

Still open for the owner: a GET release also lands in browser history and omnibox autocomplete, and re-opening it sends `Sec-Fetch-Site: none` — allowed — so a shared browser's second user can replay an unconfirmed release. `Cache-Control: no-store` prevents caching, not history. Converting to `POST … { action: "release" }` would close that and let the response name who is being released; it needs a new endpoint, which is what this decision originally avoided.

**Also amended (round 3):** the release control is withheld when the parent group is at capacity — see Goals — and `POST /api/invite/claim` gained its own proxy-aware origin check (`lib/same-origin.ts`), because behind the documented Caddy/HTTPS deployment `request.url` is `http://` while the browser's `Origin` is `https://`.

### D5. Baseline migration regenerated — local DB discarded under owner authorization

Per the `database-baseline` convention (one initial migration + snapshot + journal, replaced as a unit), the migration directory is **deleted and regenerated from empty** (`db:generate --name initial`), producing exactly `0000_initial.sql` + `meta/0000_snapshot.json` + a one-entry journal tagged `0000_initial`. Running `db:generate` _against the committed baseline_ would instead append a `0001_*` migration, breaking the suite's single-entry assertions (`database-baseline.spec.ts`) and the per-entry hash guard — hence delete-first.

Regenerating `0000` changes its hash, so the guarded migrator (`migrate.mjs`) **refuses to run against any existing database** — it does not "recreate" anything. `packages/db/local.db` held preserved guest data, so this required an owner decision. **Decided (2026-09-28): option A — the data is disposable.** The replacement follows `ops/README.md`'s separately authorized procedure: stop writers and AVIF jobs, delete `local.db{,-wal,-shm}`, re-run `db:migrate` against the regenerated baseline, verify. Considered and rejected: **(B)** an additive `0001` migration (would have contradicted this change's own `database-baseline` delta and the main spec's one-baseline requirement, forcing test-assertion rework for data the owner does not need) and **(C)** the 2026-09-16-style data-preserving conversion (backup bundle, rehearsal, conversion script — real work whose only product was preserving disposable rows).

### D6. `resolveInvite` gains identity kind; every surface gets an explicit data path

`ResolvedInvite` gains `kind: "individual" | "member" | "group"` (and for groups, `maxMembers`/`claimedCount` — one extra `COUNT` query only when the resolved row is a group). Consumers:

- `api/invite/me.ts` — pass through `kind` + `group` block (spec delta).
- `api/rsvp/index.ts` POST — `kind === "group"` → `409 claim_required`; `individual`/`member` unchanged. GET unchanged.
- `api/guest-photos/index.ts` POST — same guard before any body handling. GET payload unchanged (stays identity-minimal).
- `api/invite/opened.ts`, greeting — unchanged (identity-type agnostic).
- **RSVP surface:** `index.astro`'s inline invite query (it does not use `resolveInvite`) gains `type`/`parentId`/`maxMembers` + member count, passing `inviteKind`/`groupQuota` props to `RsvpSection`; `isInvitee` gating excludes group cookies, rendering the claim prompt / capacity state instead of the RSVP controls.
- **Photo surface:** `photo-trail.ts` checks `GET /api/invite/me` (already cookie-gated per invite-session) before revealing the upload CTA for group identities; narrows its 409-success branch to `already_posted`; adds `claim_required`/`group_full` to `PHOTO_ERRORS`.

## Risks / Trade-offs

- [Quota guard degrades to read-then-write during a future refactor] → the atomic statement is a single helper (`claimMemberSlot`) with a dedicated concurrency test (5 parallel claims on `maxMembers=3` ⇒ ≤3 rows, losers get `409`/`503`); comment marks it as the only guard.
- [One person claims multiple slots (multiple browsers/incognito)] → inherent to cookie identity; quota bounds total slots, admin member breakdown makes duplicates visible, future slot-level unclaim can clean up. Accepted. **Owner decision (D3, round 3):** accepted as-is, with the client's ambiguous-outcome copy reworded (`AMBIGUOUS_CLAIM_COPY` in `RsvpSection.astro`) so a guest is steered away from a blind retry after a `503` or a thrown fetch — the case where a claim committed but its response was lost, and a retry mints a second row. The guest cannot self-check (member names are private), so the copy tells them to reload once and then ask rather than retry. A designed slot-release procedure is filed as a separate future change; note it is blocked by the same self-FK backstop that makes deleting a member with an RSVP or photo fail, so it needs a real procedure rather than a DELETE.
- [A GET release lands in browser history and replays with `Sec-Fetch-Site: none`] → mitigated server-side rather than by changing the endpoint: the release is refused when the group has no open slot, and since a release does not delete the member row, a member who releases and re-claims leaves the group full — so in that sequence the replayed history entry is inert. This is a narrowing, not a closure: a group that still has room (e.g. `maxMembers=5` with 3 claimed) honours a replayed `?fresh=1` from history or from a shared browser's second user, and destroys the identity. The gate is also **read-then-act**, not atomic: the quota is read and the cookie then written, so the last slot can fill in between and a release can be honoured microseconds after the group became full. Accepted — the release writes nothing, the harm is bounded to one member losing an identity they could not have re-claimed anyway, and making it atomic would mean wrapping a redirect in a write transaction for no guest-visible gain. Pre-D2 behaviour had no gate at all, so this is strictly better. **Owner decision (D2, round 3):** capacity gate now, with conversion to `POST … { action: "release" }` filed as an immediate follow-up change. POST is the structural fix (no history entry, not replayable, and the response can name who was released) but contradicts D4's recorded rationale, so it is a separate change rather than a mid-implementation reversal.
- [Framework `checkOrigin` 403s every form-like and bodiless POST behind a TLS-terminating proxy] → a **pre-existing production defect**, found while hardening this change: guest photo upload and invite-open tracking were already dead behind `Caddyfile.example`, and `/api/rsvp` survived only because JSON bodies are exempt from the form-like check — which is why nobody noticed. **Owner decision (D1 option A, round 3):** `security.checkOrigin` disabled repo-wide and replaced by a proxy-aware `isSameOriginRequest()` (`lib/same-origin.ts`) on every cookie-authenticated POST, with a uniform `403 { "error": "cross_origin_post" }`. Guarded structurally by `tests/origin-guard.spec.ts`, which fails if an endpoint omits the call or if `checkOrigin` is re-enabled. Verified against a production build with Caddy-shaped headers: `opened` 204, `claim` 201 then idempotent 200, `rsvp` 200, `guest-photos` past the guard into the image pipeline; genuine cross-origin POSTs still 403 on all four. Option B (terminate TLS in the app via `SERVER_CERT_PATH`/`SERVER_KEY_PATH`) was rejected: it keeps the framework guarantee but trades a code problem for a certificate-lifecycle one.
- [Shared browser, second person] → covered by the `?fresh=1` release path (D4), wired to a two-step-confirmed "Not you?" affordance; the second person claims their own slot while the first member's row/RSVP/photo remain intact under the original cookie. [Accidental/prefetched release downgrades an answered member irreversibly] → the release is one-way per browser (member id lives only in the cookie), so the affordance requires explicit confirmation, and a re-claim from a released browser legitimately consumes another slot (visible in the admin breakdown).
- [Baseline regeneration strands the existing `local.db`] → resolved by owner decision (D5 option A, 2026-09-28): the preserved data is disposable, so the DB is deleted and recreated under the authorized replacement procedure in `ops/README.md`; test servers create disposable DBs per run already.
- [`409 claim_required` diverges from the uniform-404 privacy posture] → only for _valid authenticated_ group identities; anonymous probing surface is unchanged (404 before body parsing, `no-store` everywhere).
- [Group seen-metrics mix pre-claim browsers and post-claim revisits] → acceptable: group-row metrics mean "link opens", member-row metrics mean "member activity"; member `seen_*` is normally zero (link metrics bump on the link id) — a member id is itself a valid invite id, so using one directly as a link would bump it, which is harmless — and the admin breakdown omits `seen_*` from `members[]` so nobody asserts otherwise.
- [New CHECK/FK errors masked as invite-id collisions] → precise collision classifier mandated in D3, with a fail-fast path and a test asserting CHECK violations surface as CHECK errors.

## Migration Plan

1. Schema + baseline regeneration in `packages/db` (delete `src/migrations/**`, `db:generate --name initial`, verify exact `0000_initial` artifacts); then the authorized local-DB replacement (D5 option A: stop writers/AVIF jobs, delete `local.db{,-wal,-shm}`, `db:migrate`, verify).
2. `invite-session` kinds + `me.ts` shape (additive — existing clients ignore new fields; exact-shape test updated).
3. Claim endpoint + `[id].ts` sticky/`?fresh=1` rules.
4. Mutation guards (`rsvp`, `guest-photos`) + client claim/name-prompt + capacity states (`index.astro`/`RsvpSection`, `photo-trail.ts`).
5. Admin POST/GET updates.
6. Doc sync (`SPEC.md`, `README.md`, `NOTE.md`, `ops/README.md`, `ops/MODERATION.md`).
7. Tests at each step; full Playwright suite at the end.

Rollback: revert schema + code together and recreate the local DB from the reverted baseline (the preserved guest data is disposable by owner decision, so there is no data rollback set); member rows are ordinary invites, so even a mixed state is harmless to RSVP/photo invariants.

## Open Questions

- Exact name-prompt UX copy/placement in the RSVP and photo surfaces (implementation detail; behavior is spec'd).
- Should the admin list paginate once groups × members grow? (Wedding scale: no — revisit if invite count grows past a few hundred.)
