# Handoff: group-invitations

## Task 1.0 — pre-flight record (executed 2026-09-21)

**Owner decision honored:** D5 option A, recorded 2026-09-28 — the guest data in
`packages/db/local.db` is disposable.

Findings before deletion:

- **No other environment holds data that must survive.** No process from this repo
  was running (no Astro dev server, no AVIF worker). `docker ps -a` showed only
  three unrelated, long-exited containers (`sub2api`, `sub2api-valkey`,
  `sub2api-postgres`) — **no production instance is deployed from this repo on this
  machine**.
- **Stray DB files / WAL siblings inventoried.** Only one real target existed:
  `packages/db/local.db` + `local.db-wal` + `local.db-shm`. The other `.sqlite`
  hits are not guest data: `apps/web/.wrangler/state/**` are miniflare KV/cache
  scratch, and `apps/web/.playwright/db.sqlite` is a stale gitignored artifact of
  an older test layout (current tests use `mkdtempSync(tmpdir())`). Left in place;
  it is unreferenced by the current suite.
- **Contents discarded:** 12 `invites`, 6 `rsvps`, 1 `guest_photos` row (drifted
  from the 2026-09-16 handoff's 11/5/4 through local dev use), ledger hash
  `47756903…`, `integrity_check` ok at snapshot time.
- **Orphaned uploads:** `apps/web/var/photos` held 31 files (7 `guest-photos/<id>/`
  dirs + a legacy `submissions/` tree) against only 1 live `guest_photos` row, so
  most were already orphaned. All became orphaned by the reset and were archived,
  then cleared (task 1.5).

**Deployment consequence (stated explicitly):** `Dockerfile:51` runs
`node packages/db/scripts/migrate.mjs` on every container start, and
`docker-compose.yml` keeps the database in the named volume `wedding-data` at
`file:/data/wedding.db`. The regenerated `0000_initial` has a **new hash**, so the
guarded migrator will REFUSE any volume initialized on the old baseline — the
container would fail to start rather than migrate. No such deployment exists here;
if one is ever created from the pre-change baseline, the same owner-authorized
replacement in `ops/README.md` must be run there (stop writers, snapshot, new
empty target or explicit in-place replacement, re-migrate, verify).

## Task 1.5 — rollback set and recorded deviation

**Rollback set** (per `ops/README.md` step 4, following the 2026-09-16 precedent):

```
/Users/ycm/Developer/oss/wedding-website-backups/2026-09-20T175109Z-group-invitations/
  before/local.db          # consistent SQLite .backup snapshot
  before/local.db.raw      # byte copy of the main file
  before/local.db-wal      # WAL state preserved
  before/local.db-shm      # SHM state preserved
  before/photos/           # all 31 files of apps/web/var/photos
  before/migrations/       # the PRIOR baseline SQL + snapshot + journal
  before/git-head.txt      # 2f83524…
  before/git-status.txt
```

Treat this bundle as private guest data. Rollback means restoring the matching
code + baseline + database + upload tree together.

**DEVIATION from `ops/README.md`:** step 5 of the authorized replacement procedure
_prefers_ pointing the service at a **new, different, empty database path** and a
new empty upload root. Here the replacement was done **in place** — `local.db`,
`local.db-wal`, and `local.db-shm` were deleted at their existing paths and
recreated by `pnpm db:migrate`, and `apps/web/var/photos` was cleared in place.
The owner's disposability ruling (D5 option A) authorizes this, and the full
snapshot above preserves the state the procedure exists to protect. Writers were
verified stopped first, including one orphaned `tests/support/dev-server.mjs`
(which used its own temp DB, not `local.db`).

Post-replacement verification: `integrity_check` ok; `invites` columns are
`id, display_name, created_at, seen_at, seen_count, opened_at, opened_count,
parent_id, type, max_members`; `invites`/`rsvps`/`guest_photos` all zero rows;
exactly 1 `__drizzle_migrations` ledger row.

## Implementation verification (manual smoke run, not committed as tests)

Per the apply instructions, test authoring and suite runs were **deferred**. The
implementation was instead verified by hand against a throwaway Astro dev server
on a temp SQLite DB (created, exercised, then deleted along with its temp dir and
the temporary launcher file). Results:

**Schema / baseline.** Fresh apply + repeat no-op; `integrity_check` ok;
`foreign_key_check` empty; exactly one journal entry `0000_initial`; `invites`
columns end `… parent_id, type, max_members`; `rsvps`/`guest_photos` DDL
byte-identical to the previous baseline. All four CHECKs reject correctly and
surface as `CHECK constraint failed: <name>` (never as an id collision):
group-without-quota → `invites_group_shape_chk`, quota 1 and 51 →
`invites_max_members_range_chk`, group-with-parent → `invites_member_shape_chk`,
individual-with-quota → `invites_group_shape_chk`, `type='member'` →
`invites_type_chk`. Self-FK backstop: `DELETE` of a group **with** a member fails
`FOREIGN KEY constraint failed`; a **memberless** group deletes fine.
`pnpm db:generate` afterwards reports "No schema changes" — no baseline drift.

**Admin.** Individual 201 carries `type: "individual"`; group 201 carries
`type: "group"` + `maxMembers`. All seven validation bodies rejected with the
right code (`invalid_max_members` ×5 incl. missing/1/51/3.5/individual-with-quota,
`invalid_type`, `invalid_parent_id`). Wrong token → bare 404, 0 bytes.

**Claim lifecycle.** Group cookie → `me` = `{displayName:"The Smith Family",
kind:"group", group:{maxMembers:3, claimedCount:0}}`. Group POST `/api/rsvp` →
`409 claim_required`, GET → `200 {attending:null}`. Group POST `/api/guest-photos`
(same-origin) → `409 claim_required` with **0 photo files created**, GET →
`200 {inviteValid:true, mineId:null}`. Claim trims (`"  Alex  "` → `"Alex"`),
returns `201 {displayName,kind:"member"}`; **Set-Cookie is byte-identical to the
link redirect's** modulo the id (`Max-Age=2592000; Path=/; SameSite=Lax`). Member
`me` → `{displayName:"Alex", kind:"member"}` with no `group` key. Re-claim →
idempotent `200` and **no** Set-Cookie. Member RSVP → `200`, readable only under
the member cookie while the group cookie still reads `null`. Anonymous /
malformed / unknown cookies → bare `404`, 0 bytes each. Invalid bodies →
`400 invalid_json` / `display_name_required` / `display_name_too_long`.
Individual cookie claim → `409 not_a_group`.

**Sticky / release / cross-group.** Member re-opening `/{group}` → Set-Cookie is
the **same member id**. `/{group}?fresh=1` → Set-Cookie is the **group id**, and
the member's RSVP still reads back afterwards. `?fresh=1` on an individual link
rebinds to that individual (no effect). A member of group A opening group B's
link rebinds to B.

**Quota under concurrency (the load-bearing guard).** 12 simultaneous claims on
`maxMembers=3` → exactly **3 × 201**, 9 × `409 group_full`, **3 member rows in
the DB**, zero 503s, no server-side errors. The atomic statement holds.

**Member independence.** Two members of one group each uploaded a photo → two
distinct `guest_photos` rows; a duplicate → `409 already_posted`; each member's
`mineId` resolves only their own photo; the group row holds **0** photo rows.

**SSR surfaces.** Anonymous → no controls. Group with open slots → claim form
present, confirm button absent, greeting = group name. Group at capacity →
capacity state, no claim form, no confirm button, greeting = group name. Member →
confirm button present plus the release link with `href="/<groupId>?fresh=1"`,
greeting = member name. **This is task 5.3's verification**: the greeting is a
straight pass-through of the resolved row's `display_name`, so no greeting code
changed.

`pnpm check-types` (0 errors, 89 files), `oxlint` (only the two pre-existing
warnings in untouched files), and `openspec validate group-invitations --strict`
all pass.

## Deferred: what the testing pass must pick up

Tasks 1.3, 1.4, 2.3, 3.4, 4.3, 6.3, 7.1–7.5 are all test authoring / test
running, deliberately left unchecked.

**One existing assertion is now RED and must be updated first** — this is task
2.3's first clause:

- `apps/web/tests/rsvp-api.spec.ts:121` — `expect(await me.json()).toEqual({ displayName: "Guest Two" })`
  must become `{ displayName: "Guest Two", kind: "individual" }`. This is an exact
  `toEqual`, so it fails against the new response shape.

Checked and **not** broken by these changes:

- `rsvp-api.spec.ts:117-118` (link rebind for a standalone individual holding a
  foreign cookie) — still correct; it is the regression guard for D4's "all other
  cases rebind".
- `rsvp-api.spec.ts:134` admin-list assertion uses `toMatchObject`, so the
  additive `type` field is fine.
- `rsvp-api.spec.ts:48-50` only asserts `not.toContain("max_party_size")`.
- `database-baseline.spec.ts:18` asserts table _names_ only; `:23-30` still hold
  (one journal entry, one `.sql` file, unchanged `guest_photos` columns/indexes/FK).
- `guest-photo-smoke.spec.ts:25-26` reads only `id`/`sharePath`.
- `restore-drill.spec.ts:68,92` and `ops/restore-drill.sh:33` insert/count
  `invites` without the new columns — defaults satisfy all four CHECKs.

Test-helper notes for the new specs: existing photo tests must send
`origin: server.baseUrl` because Astro's framework-level origin check returns
`403 "Cross-site POST form submissions are forbidden"` for multipart POSTs
without a matching `Origin` — that fires _before_ the route handler, so a
group-cookie upload test needs the header to observe `409 claim_required`.

## Adversarial review (code-reviewer) — outcome

Review verdict: the load-bearing invariants hold — the quota guard is genuinely
one atomic statement, the `no_slot`/`503`/`409` split cannot report a storage
failure as `group_full`, the CHECK set is sound (including the
boolean-to-boolean `=`), and the privacy posture is intact on all three mutation
endpoints. No defect over-allocates a slot or breaks a normative scenario on the
happy or contended path. 2 Medium + 4 Low + 4 nits were raised.

### Fixed

**M1 — the collision classifier was defeatable by a guest's own `displayName`.**
Confirmed against the installed sources and reproduced: Drizzle wraps every
raw-query failure in `DrizzleQueryError`, whose message is
`` `Failed query: ${query}\nparams: ${params}` `` — and `${params}` stringifies
the bound `displayName`. `errorChain` tested `message` on _every_ link including
that wrapper, so a guest named `"UNIQUE constraint failed: invites.id"` (32
chars, inside the 120 limit) turned **any** failure — `SQLITE_BUSY`,
`SQLITE_IOERR`, even a CHECK/FK rejection — into a phantom id collision and five
re-executions of the guarded insert against an already-failing database. That is
exactly the failure mode D3 forbids. Fixed in `lib/invite-id.ts` by anchoring the
message test (`/^UNIQUE constraint failed: invites\.id\b/i` — the wrapper always
begins "Failed query:") and matching the extended codes against a set.
Re-verified against 9 cases: poisoned BUSY/IOERR/CHECK/FK all → false; real
collision on **both** the local `file:` driver and the remote hrana shape → true;
clean CHECK/FK/NOT-NULL → false.

**M1 secondary — guest display names were being logged.** `console.error(…, error)`
wrote the DrizzleQueryError, i.e. the bound params, to stdout; `ops/MODERATION.md`
states display names stay private. Added `redactInviteError()` (logs the
driver-level `cause`, not the wrapper) and applied it in `group-claim.ts` and the
admin create path.

**L4 — half the classifier was dead code on the configured driver.**
`@libsql/client`'s `mapSqliteError` puts the BASE code in `.code`
(`SQLITE_CONSTRAINT`) and the specific one in `.extendedCode`
(`SQLITE_CONSTRAINT_PRIMARYKEY`); only the remote hrana driver passes the
extended code through as `.code`. So both `code ===` comparisons could never be
true for the `file:` driver that `Dockerfile`/`docker-compose.yml`/`NOTE.md` all
use, leaving classification resting entirely on the message regex. `errorChain`
now carries `extendedCode` and both are tested — which is also what makes the M1
fix robust on the remote path.

**M2 — no reconciliation for "committed, response lost".** A claim could commit
and then lose its response (post-commit I/O error, or an hrana timeout after the
server commits — the remote path `ops/README.md` and `DATABASE_AUTH_TOKEN`
explicitly support). The caller saw a retryable 503 carrying no `Set-Cookie`, the
browser kept the GROUP identity, and the guest's retry minted a **second** member
row — two slots for one person out of a quota that may be 2, which is an identity
dead-end (against D2's Goals). Added `findCommittedClaim(id, groupId)`, run
before returning `unavailable`: one bounded read scoped to the exact generated id
AND this group, mirroring `guest-photo-upload.ts`'s `findAttempt`. It cannot
resolve to another guest's row, and any ambiguity yields null → 503 as before.

**L3 — `rows[0]` truthiness was the only shape check.** The driver builds rows by
copying enumerable keys; an empty-but-truthy object would have returned
`{status:"claimed", id: undefined}`, set a cookie failing `INVITE_ID_RE`, and
burned a slot while reporting `201` with the guest left anonymous. Now validated
→ retryable 503.

**L2 — cross-surface dead end.** SSR (inline query) and the photo surface
(`/api/invite/me`) resolve identity independently, so SSR could degrade to
anonymous while the client still knew the visitor was a group: the pill showed
"Klaim tempatmu" and tapping it scrolled to a section with no claim form.
`openClaimFlow` now reloads when `[data-claim-form]` is absent — the same
self-healing move `RsvpSection` makes on `409 claim_required`.

**Nit — anonymous identity probe.** `AddImageButton` renders unconditionally, so
every anonymous homepage load issued a guaranteed-404 `GET /api/invite/me`. Added
a cookie-presence gate. This is explicitly _not_ authorization (eligibility still
comes only from server responses); if the probe is skipped the server's
`409 claim_required` path remains the backstop.

**Nit — a11y on the two-step release.** The armed state was conveyed only by a
visual label swap, so a screen-reader user got no signal that a second
activation was required. Added an `aria-live="polite"` sr-only hint plus
`aria-describedby`.

**Nit — "writes nothing" was false in five places.** `?fresh=1` does bump
`seen_at`/`seen_count` on the group row, as the same spec requirement mandates
two sentences later. Corrected to "creates no rows and consumes no slot" in
`README.md`, `SPEC.md`, the `group-invitations` spec delta, `design.md` D4, and
`proposal.md`. `openspec validate --strict` still passes.

### Deliberately NOT changed

**L1 — the sticky-check error path can demote a member.** `[id].ts` collapses
`resolveInvite`'s `not_found` and `error` to the same `null`, so a transient DB
failure while resolving the cookie rebinds to the group id and destroys a member
id that exists only in that cookie. **This is what D4 specifies** ("on
cookie-resolution error fall back to today's rebind behavior — never a 5xx"), and
no normative scenario covers the DB-error case, so it was left as designed rather
than silently deviating. Two notes for whoever picks it up: the window is much
narrower than it looks — if the database is actually down the metrics UPDATE and
the fallback SELECT both fail, `inviteExists` is false, and no cookie is written
at all, preserving the member id; the destructive case needs one query to fail
while the other succeeded. And the two rules do not genuinely conflict: on
`error`, skipping `setInviteCookie` while still returning the 302 preserves the
existing cookie, costs a fresh visitor nothing, and is still not a 5xx. Fixing it
means editing D4's prose, not just the code.

**Nit — two inert branches in `photo-trail.ts`.** The `409 group_full` upload
branch is unreachable (`guest-photos` only emits `already_posted`/`claim_required`,
as SPEC.md's own taxonomy table states) and `PHOTO_ERRORS.claim_required` is never
read. Task 5.2 explicitly required both entries, so they were kept as defensive
handling rather than removed.

### Re-verification after all fixes

`pnpm check-types` 0 errors; `oxlint` clean (two pre-existing warnings in
untouched files); `openspec validate group-invitations --strict` valid;
`pnpm db:generate` still reports "No schema changes". Confirmed `group-claim.ts`
is inside the checked program by injecting a deliberate type error and watching
`astro check` catch it. Live re-smoke on a fresh temp DB: 13/13 flow checks pass
(claim 201 + cookie attribute parity with the link redirect, member `me` with no
`group` key, idempotent re-claim, sticky vs `?fresh=1`, `claim_required`,
`not_a_group`, `group_full` at the boundary, exactly 3 member rows, no member
with a non-individual type) — including that the M1 exploit string is now stored
as an ordinary display name. Concurrency re-run: **15** simultaneous claims on
`maxMembers=3` → exactly 3×201, 12×409, 0×503, 3 distinct rows, no server-side
errors. All smoke servers stopped, temp dirs and the temporary launcher removed;
ports 4399/4411 free. The user's own `pnpm run dev` server on :4321 (PID 77957,
started after the DB replacement) was left running.

### Residual risk worth an owner decision

M2's fix closes the "handler survived to observe the failure" case. It cannot
close **process death or a connection reset mid-statement** — the handler never
runs, so nothing server-side can reconcile, and the guest's retry still mints a
second row. Mitigations that do exist: the admin `members[]` breakdown makes a
double-claim visible, and the quota bounds the total. If the owner wants this
closed further the options are (a) record it in `design.md`'s risk register as
accepted, or (b) change the client's post-503 copy so the guest knows their name
may already be claimed and should not blindly retry. Neither is a code-correctness
question, so neither was decided here.

## Second adversarial review round — outcome

Mandate was to attack round 1's fixes rather than re-audit the whole change.
Verdict: the round-1 fixes all behave as claimed under adversarial reading (12
specific sub-questions on `findCommittedClaim`, the anchored regex, the
`redactInviteError` chain walk, and the cookie-presence gate came back sound),
but the round found **one HIGH the first round missed**, one Medium in my own
round-1 documentation, and six Lows.

### H1 — FIXED: `?fresh=1` was a state-changing GET with no origin protection

Verified in the installed sources before acting: `astro/dist/core/check-origin.js`
declares `SAFE_METHODS = ["GET","HEAD","OPTIONS"]` and returns `false` for them,
so the framework origin check never inspects this route; and `SameSite=Lax`
_sends_ the cookie on cross-site top-level navigations. Both of the app's two
CSRF protections therefore exempt the one endpoint that destroys state. Any site
that knows a group id can `location.replace("https://…/<groupId>?fresh=1")` a
member, who then sees a generic capacity/claim page and can never act as that
member again — the exact harm the spec clause names ("an accidental tap or
prefetch cannot downgrade an answered member") and the risk design D4 claims to
mitigate.

Fixed in `pages/[id].ts` with `isExplicitReleaseNavigation(request)`: the release
is honoured only when `Sec-Fetch-Site` is `same-origin` or `none` (deliberately
**not** `same-site` — on a shared domain another tenant is same-site but
cross-origin) and `Sec-Fetch-Dest` is `document` when present. Absent headers are
allowed through, so older browsers, `curl`, and the `NOTE.md` walkthrough keep
working and the two-step confirmation stays the primary gate. A refused release
still 302s and falls back to the sticky rule, so the member is unharmed.

Verified with correlated per-request tags and a full header dump — 5/5: cross-site

- document REFUSED, same-origin + document ALLOWED, none + document ALLOWED,
  same-origin + iframe REFUSED, same-site + image REFUSED; and a plain cross-site
  open of the group link (no `fresh`) is still sticky.

**Incidental discovery worth recording:** `astro/dist/vite-plugin-astro-server/sec-fetch.js`
adds a **dev-server-only** middleware that 403s `Sec-Fetch-Site: cross-site`
requests unless `Sec-Fetch-Mode` is `navigate`/`nested-navigate`/`websocket`.
It is not wired into the production node adapter. Two consequences: (a) real
invite links clicked from email or WhatsApp are unaffected, because a browser
navigation sends `Sec-Fetch-Mode: navigate`; (b) manual `curl` testing that sends
a partial Sec-Fetch header set will hit a confusing `403 "Cross-origin request
blocked"` that has nothing to do with this change — send `Sec-Fetch-Mode: navigate`
too, or omit the Sec-Fetch headers entirely. This also means production has **no**
framework-level protection for cross-site GETs, so the gate above is the only one.

**Not done:** converting the release to `POST /api/invite/claim` `{action:"release"}`.
That is the structurally correct fix and would also let the response tell the
member _who_ they are releasing, but design D4 explicitly chose GET ("reuses the
existing link semantics … no new endpoint"), so it needs an artifact change, not a
silent one. Owner decision — see the open items below.

### M1 (round 2) — FIXED: a member at capacity was offered an irreversible dead-end

`index.astro` computed the quota only for group identities, so `RsvpSection`
rendered the release link unconditionally for members — including when the parent
group was full, where the armed copy ("claiming again uses another spot") is
false and releasing can never be undone. That is an identity dead-end, against
design Goals ("No identity dead-ends"). Members now fetch the parent group's
quota in one query (`max_members` plus a correlated member `COUNT`), and the link
is suppressed at capacity. The same query closes the reviewer's item-10 gap: a
`parent_id` pointing at a non-group row no longer yields a release href, so a
hand-edited database cannot be turned into an identity swap. Spec deltas updated
(`rsvp-section`: conditional rendering + minimum-interval + announcement clauses,
plus three new scenarios).

### M2 (round 2) — FIXED: my own round-1 ops doc stated the wrong mechanism

`ops/MODERATION.md` said removing a member row "would … orphan their RSVP/photo
records". With `ON DELETE no action` and foreign keys enabled it **fails** instead
— the same backstop the preceding bullet describes for groups. Rewritten, and the
"leave them" instruction softened to point at the residual risk below rather than
implying there is no remedy.

### Lows and nits — all fixed except one

- **L1** `specs/group-invitations/spec.md:49,54` were false as written: an explicit
  `parentId: null` / `maxMembers: null` is accepted (and must stay accepted —
  rejecting it would break every JSON client that serialises nulls), so both
  scenarios now say **non-null**. `SPEC.md` and the admin requirement text matched.
  The reviewer's alternative (tighten the code with `"parentId" in body`) would
  have been the wrong direction.
- **L2** A failed `/api/invite/me` probe used to degrade to `"none"`, making the
  chooser actionable for a group identity — contrary to the guest-photo-trail
  requirement that "unresolved/error states … SHALL NOT open a new chooser", and
  inconsistent with the file's own fail-closed philosophy. Added a fourth
  `"unknown"` state: 404 is still a definitive `"none"`, any other failure is
  `"unknown"`, which keeps `canPost` false and the pill **hidden** (a visible
  control that cannot work is worse than no control). Crucially `"unknown"` is not
  cached — one transient blip would otherwise hide the uploader for the whole page
  load — so the next `focus`/`visibilitychange` refresh retries the probe.
- **L3** My round-1 comment on `ID_COLLISION_MESSAGE` misattributed the mechanism.
  `LibsqlError`'s constructor prepends the code, so the message at that link reads
  `"SQLITE_CONSTRAINT: UNIQUE constraint failed: invites.id"` and the anchor does
  _not_ match it; the anchor only ever matches the innermost native driver error
  reached via `cause`, and `extendedCode` is what carries the configured `file:`
  driver. Net behaviour was already correct (three independent matches per driver)
  but the comment would have misled whoever next touches a security-relevant
  classifier. Rewritten to document all three links. Re-verified the classifier
  against faithful 3-link chains: real collisions match on both the local and
  remote hrana shapes; poisoned BUSY/IOERR/CHECK do not.
- **L4** The two-step had no minimum dwell, so a nervous double-tap (~35–200 ms)
  armed and navigated as one gesture. Added a 450 ms floor; a too-fast second
  activation is refused and re-arms the timer.
- **L5** The 6 s auto-disarm was shorter than the ~24-word hint (15–20 s at a
  default screen-reader rate) and reverted silently, leaving the next Enter to
  re-arm instead of navigate. The countdown now pauses on `focusin`, restarts on
  `focusout`, and a lapsed confirmation announces "Release cancelled."
- **L6** The admin list ordered by `createdAt` alone; a claim storm mints several
  members in the same millisecond, leaving their order to the query planner. Added
  the `desc(invites.id)` tiebreaker every other list in the repo uses — this is how
  a list test starts flaking.
- **N1** `findCommittedClaim` validated `row.id` but not `displayName`, so a
  malformed row would 201 with `displayName: undefined` into the response body.
  Aligned with the happy-path guard.
- **N2** Documented why the collision branch deliberately skips reconciliation (a
  collision proves our insert did not commit; and even a false positive is
  harmless because the read is keyed on the colliding id and would return null).
- **N3** `openClaimFlow` called `showError()` immediately before a reload that
  discards the message; moved the clear to after the form-exists check. Renamed the
  module-local `reload` to `reloadPhotos` — it sat four lines from
  `window.location.reload()` and read as if it were the same thing.
- **N4** The claim form had no `action`/`method`, so a no-script submit did
  `GET /?displayName=…`, putting a private display name into history, the address
  bar, and any Referrer. Now `method="post" action="/api/invite/claim"`: the name
  stays in the body and the endpoint answers 400 for the non-JSON body — a poor
  no-script experience that leaks nothing, on a site that already requires
  scripting everywhere.

**N5 — NOT fixed, deliberately.** A `displayName` of only zero-width characters
(`"\u200b"`) passes `trim()` and is stored, so it renders blank in the greeting and
in the couple's admin breakdown. Rejected because it is pre-existing at the admin
endpoint too (not a regression from this change), it is cosmetic, and the spec text
says "trimmed, 1–120 characters", which such a value literally satisfies — so
closing it properly means a spec wording change plus a shared display-name
validator module. Disproportionate for the lowest-ranked nit. Recorded here so it
is a decision, not an oversight.

### Defence in depth added (reviewer's CSRF hardening recommendation)

The JSON POSTs were confirmed genuinely safe — Astro 7's `security.checkOrigin`
defaults to `true` and compares full origins, so a cross-site form CSRF is refused
framework-side — but that guarantee lived only in a framework default. Pinned
`security: { checkOrigin: true }` in `astro.config.mjs` with a comment explaining
that it exempts safe methods and therefore says nothing about `?fresh=1`, and gave
`POST /api/invite/claim` its own explicit origin check mirroring
`/api/guest-photos`, since that endpoint mints rows against a scarce quota. Placed
after identity resolution and before body parsing, so an anonymous caller still
gets the uniform bare 404.

### Open items for the owner

1. **Release as GET vs POST.** The Sec-Fetch gate closes both concrete attack
   triggers, but a GET that changes state is still structurally wrong, and D4's
   recorded rationale for choosing it is now weaker than it looked. Converting to
   `POST … {action:"release"}` would also let the response name who is being
   released. Requires editing D4 and the release requirement.
2. **The unclosable claim duplicate.** Round 1's `findCommittedClaim` covers a
   failure the handler survives. Process death or a connection reset mid-statement
   still leaves a committed member whose browser never got the `Set-Cookie`, so the
   guest's retry consumes a second slot — and the client's 503 copy says "Please try
   again", actively encouraging it, while `MODERATION.md` says leave double-claims
   alone. Together those turn a transient blip into permanent quota loss with no
   documented remedy. Not a code-correctness question: either accept it in the risk
   register, or change the post-503 copy, or design the reviewed slot-release
   procedure. Making the endpoint idempotent on `(group, displayName)` was
   considered and rejected — it would let one guest bind to another's identity by
   guessing their name.

### Re-verification after round 2

`pnpm check-types` 0 errors · `oxlint` clean (same two pre-existing warnings in
untouched files) · `openspec validate group-invitations --strict` valid ·
`pnpm db:generate` still "No schema changes". Live re-smoke on a fresh temp DB:
**14/14** — gate matrix (cross-site refused, same-origin allowed, none allowed,
iframe refused, plain cross-site open still sticky), release link present with an
open slot and suppressed at capacity while the member keeps their confirm button,
group capacity state, 4th claim `409`, exactly 3 member rows, cross-origin claim
POST `403`, `claim_required` guard, anonymous claim bare `404`. Smoke server
stopped, launcher and temp dirs removed, port free; the user's own `pnpm run dev`
on :4321 left running.

## Third adversarial review round — outcome

Mandate: audit round 2's fixes, which nothing had reviewed. Verdict: the
Sec-Fetch gate, the correlated subquery, the `checkOrigin` pin, and the
comment-only fixes were all sound — but the round found **one HIGH that makes the
group flow dead on arrival in the documented HTTPS deployment**, plus a Medium
that was a regression I introduced in round 2.

### H1 — FIXED (and it exposed a pre-existing production bug)

`claim.ts`'s new origin check compared `Origin` against `new URL(request.url).origin`.
Behind the documented Caddy deployment that can never match. Verified in the
installed sources, not assumed:

- `@astrojs/node` standalone uses `createRequestFromNodeRequest`, which derives
  the scheme from `req.socket.encrypted` and passes `void 0` for the forwarded
  protocol — so `request.url` is `http://<host>` while the browser's `Origin` is
  `https://<host>`. Its sibling `createRequest` _does_ honour `x-forwarded-proto`,
  but the node adapter never calls it.
- `Caddyfile.example` is `wedding.example.com { reverse_proxy web:4321 }` — TLS
  terminates in Caddy, plain HTTP to the app. `astro.config.mjs` sets no `site:`.

**Proved at runtime**, not just by reading: built the production bundle, ran
`node dist/server/entry.mjs`, and sent requests with the exact header shape Caddy
produces (`Host`, `Origin: https://…`, `X-Forwarded-Proto: https`,
`X-Forwarded-Host`). Before the fix: `POST /api/invite/claim` → `403`. After: `201`.

**The same experiment surfaced a pre-existing production defect that is NOT part
of this change and is NOT fixed here.** Astro's own `isForbiddenCrossOriginRequest`
performs the identical naive comparison in middleware that runs _before_ route
handlers, so behind Caddy today:

| endpoint                  | body                  | status today                                                    |
| ------------------------- | --------------------- | --------------------------------------------------------------- |
| `POST /api/rsvp`          | `application/json`    | works — JSON is exempt from the form-like check                 |
| `POST /api/guest-photos`  | `multipart/form-data` | **403 "Cross-site POST form submissions are forbidden"**        |
| `POST /api/invite/opened` | none                  | **403** (bodiless POST falls through to `return !isSameOrigin`) |

Guest photo upload and open-tracking are already broken on the only functional
production topology. (The plain `docker-compose.yml` HTTP path cannot work either:
`NODE_ENV=production` sets `Secure` cookies, which a browser will not send over
HTTP.) RSVP surviving is exactly why nobody noticed. **This needs its own change** —
the fix has to happen at the framework-middleware layer (a configured public
origin, or TLS termination in the app via the supported `SERVER_CERT_PATH` /
`SERVER_KEY_PATH`), not in route handlers. Do NOT "fix" it by setting
`security.checkOrigin: false`: that removes `/api/rsvp`'s only form-CSRF protection.

Fix applied here: a new shared `apps/web/src/lib/same-origin.ts` with
`isSameOriginRequest(request)`, which reconstructs the public origin from
`x-forwarded-proto`/`x-forwarded-host` when the socket-derived one does not match.
Used by both `claim.ts` and `guest-photos/index.ts` (the latter's own check is now
proxy-aware too, so only the framework layer still blocks it).

Trusting `X-Forwarded-*` was analysed and recorded in the module's doc comment,
with the spoofing case tested rather than reasoned about: `Origin:
https://evil.example` is refused; the same request plus a matching spoofed
`X-Forwarded-Proto`/`-Host` is accepted. That is not an escalation, because
(1) browsers cannot set those headers cross-site — they are not CORS-safelisted,
and a cross-site form cannot add headers at all; (2) `SameSite=Lax` withholds the
cookie on cross-site POSTs anyway, so the victim's identity never arrives; and
(3) in the documented HTTPS deployment the app is bound to `127.0.0.1:4321`, so
only Caddy can reach it. The only party who can spoof is a direct non-browser
client, which can equally set `Origin` and would already need the cookie value.

### M1 — FIXED: a round-2 regression I introduced

Round 2 added a second query for a member's parent-group quota inside
`index.astro`'s existing `try`. Its catch resets ALL FIVE identity variables, so a
failure of that _auxiliary_ query — the one feeding an optional affordance —
discarded a successfully resolved member identity and rendered the anonymous
branch. A valid, answered member would lose their greeting and confirm button,
turning a cosmetic degradation into an identity dead-end. The parent query now has
its own scoped `try/catch` that clears only `inviteGroupLinkId`/`inviteGroupQuota`.
The GROUP branch deliberately keeps the outer catch: there the quota decides
whether to offer the claim form at all, so failing closed to anonymous is the
safer degrade (offering a claim form with unknown quota would let a full group
loop submit → 409 → reload → submit).

### M2 — FIXED: the two-step was bypassed by every gesture that is not a `click`

With a static `href`, middle-click/`auxclick`, the context menu's "Open Link in
New Tab", **iOS long-press** (the shared-family-phone case this feature exists
for), drag-to-bookmarks, Copy Link Address, and a single tap with scripting
disabled all reached `/{groupId}?fresh=1` with `Sec-Fetch-Site: same-origin`/`none`

- `Sec-Fetch-Dest: document` — straight through the new server gate. The release
  control is now a `<button>` with the target in `data-release-href`, navigated by
  `window.location.assign` on the confirmed activation. `location.assign` from our
  own page sends the same Sec-Fetch metadata, so the gate still passes; there is no
  URL in the DOM for those gestures to act on; and the no-script path is inert
  instead of destructive. Verified in the served HTML: zero `<a href=…fresh=1>`
  elements, and the client module ships `location.assign`, `MIN_ARMED_MS`, and
  `onDisarmTick` with the old `focusin`/`focusout` listeners gone.

**New evidence for the owner's GET-vs-POST decision:** because the release is a
GET, `/{groupId}?fresh=1` enters browser history and omnibox autocomplete, and
re-opening it sends `Sec-Fetch-Site: none` — which the gate _allows_ — so a shared
browser's second user can replay an unconfirmed release. `Cache-Control: no-store`
prevents caching, not history. Recorded in `design.md` D4.

### M3 — FIXED: the L5 focus-pause never engaged, and could leave the control armed forever

`focusin` fires _before_ `click` for mouse, touch, and VoiceOver activation, so on
the primary keyboard/screen-reader path nothing ever paused the first timer: 6 s
later the label reverted and "Release cancelled." was announced mid-hint while the
control still held focus — L5's stated goal was not achieved. Worse, the
`focusin`→`clearDisarm` pair could leave `armed === true` with no pending timer
(arm → Tab away → Shift+Tab back within 6 s → focus never leaves → armed forever),
which on a shared browser means one stray Enter destroys the first member's
identity with no confirmation. Replaced both listeners with a self-rescheduling
tick that checks `releaseControl.matches(":focus")` **at fire time**: it genuinely
pauses while focused, and can never leave `armed` with nothing pending.

### M4 — FIXED: L2 over-corrected and stranded eligible individuals

`"unknown"` was not group-specific, but `canPost` conjoins `groupState === "none"`,
so an _individual_ invitee lost the uploader when only the secondary
`/api/invite/me` endpoint blipped while `/api/guest-photos` answered fine — and
retry was driven solely by `focus`/`visibilitychange`, so a single-page visit
never recovered. Added one delayed (3 s) retry on `"unknown"`, cleared in the
dispose teardown.

### Lows and nits — all fixed except where noted

- **L1** The `409 claim_required`/`group_full` branches set `groupState` without
  invalidating the cached `groupProbe`, so the next refresh silently reverted a
  quota that had filled on another device. Both now null the probe; the
  `syncGroupState` reset is identity-guarded so a stale continuation cannot drop a
  newer in-flight probe.
- **L2** The `astro.config.mjs` comment was wrong twice: `checkOrigin` returns
  false for any non-form content-type, so it never inspects an `application/json`
  POST (what blocks a cross-site JSON CSRF is the failing preflight), and
  `/api/invite/claim` no longer relies on it. Rewritten, with an explicit warning
  not to set it false. The pin itself was confirmed a no-op — `defaults.js` sets
  `checkOrigin: true`.
- **L3** `parentGroupFull` failed **open** on missing quota data. The guard is now
  folded into `releaseHref`, so an unknown quota yields no release affordance and
  `releaseHref` is member-only by construction.
- **L4** The confirmed-navigation branch did not clear the pending tick, so a slow
  navigation could announce "Release cancelled." over a release that succeeded.
- **L5** The new `403 cross_origin_post` is now in the claim requirement, a new
  scenario, and `SPEC.md`. Note the two 403s still differ in shape — `guest-photos`
  returns an empty body, `claim` returns JSON; recorded rather than unified, since
  `guest-photos`' shape is pre-existing.
- **L6** `design.md` Goals said a shared browser can **always** reach a fresh group
  identity, contradicting the new capacity scenario — qualified. D4 amended with
  rounds 2–3. `tasks.md` 5.1's "(+ member COUNT when type='group')" was stale.
  `index.astro`'s "Only a group cookie pays for the extra COUNT" comment was
  literally false and is reworded. Confirmed **D6 is not contradicted** — its
  "only when the resolved row is a group" clause is scoped to `resolveInvite`,
  which still honours it exactly.
- **L7 (no change needed)** The correlated subquery was verified correct:
  `${parentId}` is a bound parameter, not interpolation; the `siblings` alias
  cannot collide with the unaliased outer `FROM invites`; it is served by
  `invites_parent_id_idx` and runs once.
- **L8** A refused too-fast activation now says "Wait a moment, then activate
  again to confirm." instead of looking broken; `"Release cancelled."` moved out of
  the `aria-describedby` target into a separate live region (it was becoming the
  control's permanent description); `members[]` ordering (newest-claimant-first)
  documented in the spec delta and `SPEC.md` — confirmed at runtime as
  `["Bee","Alex"]`; `NOTE.md` now says the release link disappears at capacity.

**Not fixed:** N5 from round 2 (zero-width-only display names) — unchanged
rationale. And the reviewer's suggestion to set `site:` in `astro.config.mjs` as
the clean long-term origin fix: it needs a per-deployment env-driven value and
touches canonical-URL behaviour, so it belongs with the separate
production-origin change rather than here.

### Re-verification after round 3

`pnpm check-types` 0 errors · `oxlint` clean · `openspec validate --strict` valid ·
`db:generate` no drift. **Production build** (`astro build` + `node
dist/server/entry.mjs`) under a simulated Caddy proxy: claim `201` (was `403`),
member RSVP `200`, genuine cross-origin claim `403`, and the two pre-existing
framework `403`s reproduced and characterised. **Dev-server markup/behaviour:**
release control is a `<button>` with no navigable `fresh=1` href anywhere in the
DOM, `data-release-href` carries the target, static description and live region are
separate, `describedby` points at the static one; client module ships
`location.assign`/`MIN_ARMED_MS`/`onDisarmTick`/`matches(":focus")` and no
`focusin`/`focusout` listeners; capacity suppresses the release control while the
member keeps their confirm button and does not see the group capacity state; claim
form has `method="post"` + `action`; **Sec-Fetch gate 6/6** (cross-site refused,
same-origin allowed, none allowed, same-site refused, iframe refused, image
refused) and plain opens stay sticky. **Functional regression 19/19**, including
the non-null admin rules from the L1 rewording (`maxMembers: null` and
`parentId: null` accepted; non-null `parentId` and unknown `type` rejected).

Two harness bugs of my own were caught and corrected during this round rather than
reported as findings: a `sf()` helper that concatenated curl's `-w` output with the
cookie value, and a `ck()` helper that expanded header strings without `-H`
prefixes so no Sec-Fetch headers were actually sent. Both initially made correct
code look broken; each was re-run with correlated per-request tags before drawing
conclusions.

### Testability notes added for the deferred pass

1. **H1 is invisible to this test harness.** `tests/support/dev-server.mjs` runs
   `astro dev` on `http://localhost`, so `Origin` and `request.url` always agree.
   Catching it needs a proxy-shaped assertion: send `Origin: https://x` with
   `X-Forwarded-Proto: https` and `Host: x` over plain HTTP and assert non-403.
   Worth adding as a regression guard, and note it can only be written against a
   built server, not `astro dev`.
2. **The cross-site release scenario needs `Sec-Fetch-Mode: navigate`.** The
   dev-only `secFetchMiddleware` 403s `Sec-Fetch-Site: cross-site` without it, so a
   naive test would assert the middleware's 403 instead of the app's
   cookie-preserving 302 and pass for the wrong reason. `page.goto()` is safe
   (Chromium sends `Sec-Fetch-Site: none`).
3. **M3 needs a focus-order assertion, not a timer assertion.** Arming via
   `link.click()` then fast-forwarding 6 s passes while the real keyboard path
   fails. Assert the control is still armed at t=7 s _while focused_, and disarms
   after focus leaves.
4. **The release control is a `<button>` now** — task 7.4's "two-step confirmation"
   assertions must not look for an anchor or an `href`. The navigable URL lives in
   `data-release-href` and the hook is `data-release-control`.

## Owner decisions on the three escalated items — implemented

All three were decided and implemented in this change; `tasks.md` §9 records the
work, `design.md`'s risk register records the decisions and the rejected
alternatives.

### D1 = option A, with the architecture test

`security.checkOrigin` is now **disabled** in `astro.config.mjs` and replaced by
`isSameOriginRequest()` from the new `lib/same-origin.ts`, called by all four
cookie-authenticated POSTs (`claim`, `guest-photos`, `rsvp`, `invite/opened`) with
a uniform `403 { "error": "cross_origin_post" }`. `guest-photos`' pre-existing
empty-body 403 was folded into the shared shape — nothing legitimate ever sees it,
so unifying costs nothing and makes the guard greppable.
`api/admin/[token]/invites` is exempt on purpose and the exemption is documented in
both the test and the spec: its authority is a secret in the path, not an ambient
cookie, so CSRF cannot supply it.

`tests/origin-guard.spec.ts` is the architecture guard, and it was
**mutation-verified** rather than merely written: removing `isSameOriginRequest`
from one endpoint fails it, and re-enabling `checkOrigin: true` also fails it — the
second matters because a re-enabled framework check would both break production and
make the behavioural assertions pass for the wrong reason. The spec also asserts the
endpoint inventory exactly, so moving or adding a route vacating the scan is caught.
5/5 pass.

**Verified in a production build** (`astro build` + `node dist/server/entry.mjs`)
with Caddy-shaped headers: `invite/opened` 204 (was 403), `claim` 201 then
idempotent 200, `rsvp` 200, `guest-photos` past the guard into the image pipeline
(was 403 at the framework). Genuine cross-origin POSTs still 403 on all four with
the uniform body.

### D2 = server-side capacity gate now, POST conversion filed

The release is now refused server-side when the group has no open slot, or when its
quota cannot be read (fail closed — a destructive action must not proceed on unknown
state). This is what actually neutralises the history-replay vector: a release does
not delete the member row, so a guest who releases and re-claims leaves the group
full and the replayed `?fresh=1` entry is inert. Verified: at capacity the release
is refused for `same-origin`, `none` (history/omnibox replay), and `cross-site`,
while the member cookie is preserved; with a slot open, `same-origin` and `none`
still release; a visitor with no cookie is unaffected; a plain open stays sticky.

An incidental finding worth recording: releasing does **not** free the slot. The
member row persists, so "release then re-claim" costs two slots — which is exactly
what the armed copy warns about, and `NOTE.md` now says so explicitly.

Filed as `openspec/changes/release-via-post/` (proposal only, 1/4 artifacts — it
will report "no deltas" until the propose workflow runs, which is the intended
state). The proposal records why POST is the structural fix, the decision still
open about whether to keep `?fresh=1` as an alias, and the constraint that D4 must
be amended rather than silently contradicted.

### D3 = accept, reworded copy now, slot-release filed

`AMBIGUOUS_CLAIM_COPY` in `RsvpSection.astro` replaces "Please try again" for the
two outcomes where a claim may have committed: a `503`, and a thrown fetch. It tells
the guest not to keep retrying, to reload once, and then to ask rather than retry
blind — they cannot self-check, because member names are private. A `403` and other
definite failures keep the plain retry copy, since nothing committed there. `RSVP`'s
own 503 copy was deliberately left alone: that endpoint is an idempotent upsert, so
a blind retry is safe.

`ops/MODERATION.md` corrected (it claimed deleting a member orphans their records;
with the self-FK it _fails_), and its "leave them alone" instruction replaced with a
pointer to the filed procedure. Filed as
`openspec/changes/member-slot-release/` (proposal only), capturing the FK blocker,
the three design options, and the rejected `(group, displayName)` idempotency idea.

### Shared code extracted while doing this

`readGroupQuota()` moved into `lib/invite-session.ts` and now backs all three call
sites — `index.astro`'s group branch, its member branch, and the new `[id].ts`
capacity gate — replacing two hand-written copies of the correlated COUNT. It
**throws** on database error rather than swallowing it, so each caller chooses its
own fail direction: `index.astro` degrades a group to anonymous (never offer a claim
form on unknown quota, which would let a full group loop submit → 409 → reload),
while `[id].ts` refuses the release. The member branch keeps its scoped
`try/catch` so an auxiliary failure still cannot discard a resolved identity.

### Regression found and fixed while implementing D1

The M4 fix from round 3 had made the photo pill's identity probe **lazy**, so it
fired after `await loadGuestPhotos()` — two serial round trips before the pill could
paint. That directly works against the concurrent `adaptive-media-tiering` change,
whose whole purpose is protecting the latency budget on slow connections. The probe
is eager again and runs in parallel with the first collection read, restoring round-1
behaviour while keeping the retry-on-`unknown` logic. Worth telling that session: the
probe only fires when the browser actually holds an invite cookie (anonymous visitors
make no identity request at all) and is one primary-key lookup, but it _is_ on the
critical path for the photo pill's first paint.

### Final state

`pnpm check-types` 0 errors · `oxlint` clean (same two pre-existing warnings in
`number-ticker.ts` and `photo-upload-indicator.ts`, both untouched) ·
`openspec validate group-invitations --strict` valid · `db:generate` no drift ·
`origin-guard.spec.ts` 5/5 and mutation-verified · production-build proxy matrix
green · 15/15 capacity-and-release checks. Progress **30/41**; the 11 remaining are
the deferred test tasks (1.3, 1.4, 2.3, 3.4, 4.3, 6.3, 7.1–7.5), and 7.4's text was
corrected so that pass asserts on `data-release-control`/`data-release-href` rather
than looking for an anchor that no longer exists.

`rsvp-api.spec.ts:121` is still red and is still the first thing the testing pass
must fix (`toEqual({ displayName: "Guest Two" })` needs `kind: "individual"`).

## Fourth adversarial review round — outcome

Mandate: audit the owner-decision implementation, including the removal of a
framework-wide security control. Verdict: **no High**. The reviewer independently
enumerated every mutating surface under `src/pages` (five POSTs, nothing else — no
`.astro` handler exports, no `src/actions.ts`, no `astro:actions`, no `server:`
islands, no `src/middleware.ts`, no `src/fetch.ts`, and the only `[...key]` route is
GET-only), traced `text/plain` JSON smuggling against all four guarded endpoints,
and confirmed guard-before-side-effect ordering on each. Four Mediums, all fixed.

### M1 — FIXED: the D3 mitigation did not fire for the production shape of the D3 failure

The reworded ambiguous-outcome copy keyed on `res.status === 503`. But the risk D3
accepted is _process death or a connection reset mid-statement_, and behind the
documented Caddy topology that surfaces to the browser as a **proxy-synthesised
502/504**, not an app 503 — the app died after the `INSERT` committed and before
headers were written. So the guest got the plain "Please try again", retried, and
minted the second member row the copy exists to prevent. The one mitigation bought
for this risk did not cover the case it was bought for.

Now `>= 500`, with `403 cross_origin_post` broken out into its own branch (a
definite failure, nothing committed, plain retry safe). Scope checked: only the claim
form was affected — RSVP is an idempotent upsert where blind retry is safe and was
deliberately left alone, and `photo-trail.ts` already routes any unrecognised status
to `uncertain` + reconcile-not-reupload.

### M2 — FIXED: four comments asserted a framework backstop this round deleted

The most consequential documentation defect in the diff, because these are the
comments a maintainer reads when deciding whether the app-level guard matters.
`same-origin.ts`'s header said form-like and bodiless POSTs "are still rejected by
the framework … a separate, pre-existing defect" — false, in the header of the module
that _replaced_ it, and it implied a second control existed for exactly the
`text/plain` vector. `claim.ts` still said "defence in depth on top of Astro's
framework-level checkOrigin … should not depend on a config default staying set",
which is now inverted: it _is_ the only check and it _does_ depend on
`checkOrigin: false` staying set. `guest-photos` described the framework defect as
still present. `[id].ts` said the app "relies on" checkOrigin. All four rewritten;
`same-origin.ts` now states plainly that there is no second control behind it.

### M3 — FIXED: the new `invite-session` requirement contradicted the release requirement

"Every endpoint that mutates state on the strength of the cookie SHALL verify the
request originates from this site" is unsatisfiable by `GET /{id}?fresh=1`, which
mutates state on cookie strength and cannot carry an `Origin` header at all on a
cross-site top-level navigation — which is precisely why `[id].ts` uses
`Sec-Fetch-Site` instead. As written the two requirements contradicted each other and
the contradiction would have landed in `openspec/specs/invite-session/spec.md` on
archive. Scoped to "in response to a non-safe method", with an explicit
cross-reference to the release requirement's Sec-Fetch and capacity gates as the
equivalent protection for that shape. The scenarios were already correctly scoped to
POSTs.

### M4 — FIXED: the architecture test never asserted the "no state changes" half of its own scenario

The spec scenario says `403` **and no state changes**; the test asserted only status
and body. So moving a guard _below_ its side effect — the refactor shape people
actually produce when "authenticate, authorise, act" becomes "authenticate, act,
authorise" — passed all five specs while a cross-origin POST inflated `opened_count`,
wrote an RSVP, and minted a member row against a quota that may be 2. This was the
third mutation the round was asked to find.

The test now snapshots `opened_count`, the `rsvps` count, the `invites` count, and
the group's member count around the cross-origin loop and asserts equality, with the
claim endpoint pointed at a **group** fixture so an unguarded call would mint a row.
**Mutation-verified:** hoisting `opened.ts`'s guard below its `db.update` now fails
with `openedCount: 0 → 1`; restored, 6/6 pass.

Scan boundaries widened at the same time, each a real hole rather than a
hypothetical: `MUTATING_METHODS` now includes `ALL` (`endpoint.js` resolves
`mod[method] ?? mod.ALL`, so an exported `ALL` is a live DELETE handler a POST-only
scan never inspects); the export regex now matches `export function`/`export async
function`, not just `export const`; the extension filter covers `.js`/`.mjs` (both in
Astro's `ROUTE_FILE_EXTENSIONS`); the scan root moved from `src/pages/api` to all of
`src/pages`; and symlinks are resolved instead of silently skipped. Also added, per
N4/N5: the proxy test asserts each endpoint's **real** expected status rather than
merely "not 403", and a new spec pins that an anonymous cross-origin POST still gets
the uniform **bare 404 with an empty body** — the only thing keeping endpoint
existence invisible, and previously unasserted. The file's doc comment now states its
two known boundaries (Astro Actions are invisible to it; mutating GETs are out of
scope by design).

### Lows and nits — all fixed except where noted

- **L3** `canClaimSlot` failed **open** on unknown quota while the release path
  failed closed: `groupAtCapacity` requires a non-null quota, so `inviteKind="group"`
  with no quota rendered the name-prompt form — the exact submit → 409 → reload loop
  `index.astro` degrades to avoid. Latent only because `index.astro` threw. Now
  `isGroupIdentity && groupQuota !== null && !groupAtCapacity`.
- **L4** `index.astro`'s `throw new Error("group quota unavailable …")` replaced with
  a plain reset of the five identity variables. Reachable only if a memberless group
  is hand-deleted between two adjacent `await`s (`readGroupQuota`'s non-group branch
  is dead — nothing `UPDATE`s `invites.type` — and a group _with_ members cannot be
  deleted), so the throw manufactured an exception that would read as a bug in the
  container log. Same fail-closed outcome, no noise; verified no such log line appears
  across all six homepage renders.
- **L5** `resolveInvite` keeps its own `COUNT(*)` rather than calling
  `readGroupQuota`; documented as deliberate (it already holds the row, so the shared
  helper would re-SELECT `type`/`max_members` it has in hand) with a "change both"
  warning. Confirmed no drift today.
- **L6** Guard/authorisation ordering was inconsistent: `guest-photos` returned
  `409 claim_required` **before** its origin guard while `rsvp` guarded first. Not
  exploitable (`SameSite=Lax` withholds the cookie cross-site, and the cookie is
  host-only with no `Domain`), but it let a cross-origin caller holding a group
  cookie learn group state from one endpoint and not the other. `guest-photos` now
  guards first; verified `403` cross-origin vs `409` same-origin on both endpoints.
- **L7** `SPEC.md`'s 409-taxonomy paragraph had been orphaned below the new section
  by my own round-3 insertion; moved back under its heading, and the origin section
  promoted from `###` under "Group invitations" to a top-level `##`, since the
  invariant is app-wide.
- **L8** The "cannot be fixed from config" rationale cited only `core/middleware/load.js`.
  The same predicate is also applied in `core/pages/handler.js` via `core/fetch`, so
  the conclusion is stronger than stated — added, plus the one genuinely new exposure:
  `checkOrigin` also guards **Astro Actions**, of which there are none, but a future
  Action would be served at `/_actions/*` with no origin check and invisible to
  `origin-guard.spec.ts`. Recorded in `astro.config.mjs` and `SPEC.md` so Actions are
  not adopted without extending the test first.
- **N1** `release-via-post/proposal.md` promised the architecture test "will require
  it automatically"; it asserts an **exact** inventory, so the implementer must extend
  the list too. Corrected, along with its overstated "partial mitigation" caveat.
- **N2** Three places claimed the capacity gate _closes_ the history-replay hole. It
  only closes it once the group is full: at `maxMembers=5` with 3 claimed, a replayed
  `?fresh=1` from history or a shared browser's second user still destroys the
  identity. `design.md`, the `group-invitations` delta, and `proposal.md` now say
  "narrows, does not close" — the same class of overclaim round 2 caught in the
  `?fresh=1` docs.
- **N3** `same-origin.ts` compares the socket-derived origin first, so a
  scheme-downgraded `Origin: http://<host>` is accepted behind the TLS proxy. Not
  exploitable (Caddy auto-redirects :80; the app binds `127.0.0.1:4321`), exact parity
  with the framework's own behaviour, and a configured `site:` would remove it — so
  documented in the module header rather than changed.
- **L1** `group-invitations/proposal.md` was stale against what shipped: no mention of
  `checkOrigin: false`, `lib/same-origin.ts`, `origin-guard.spec.ts`, the Sec-Fetch
  gate, or the capacity gate, and its `invite-session` bullet omitted the new ADDED
  requirement. This is the human-facing record of a change whose largest single act
  was removing a framework-wide security control, so it now carries all of it,
  including both accepted residual risks and the two filed follow-ups.
- **L2** `member-slot-release/proposal.md` contradicted itself (said the client
  "currently encourages" the retry that its own §Context says was reworded) and
  undercounted the situations from two to **three** — the third being a member who
  wants out or claimed with the wrong name _while the group is at capacity_, which is
  new, guest-unreachable precisely because of the D2 gate, and the strongest argument
  for that change.

### Confirmed sound, no change needed

Blast radius of `checkOrigin: false` (complete enumeration above); `text/plain`
smuggling is stopped twice over — `SameSite=Lax` withholds the cookie so
`resolveInvite` 404s first, and a presented cross-origin `Origin` 403s before any
parse, with `Origin: null` also refused; guard-before-body-parsing on all four
(`guest-photos` before the content-type test and `formData()`, so the 10 MiB
multipart buffer is never touched on a refused request); `readGroupQuota`'s
correlated subquery (bound parameter, uncorrelated so it evaluates once, `siblings`
cannot collide with the unaliased outer `invites`, served by `invites_parent_id_idx`);
**D2 does not strand anyone** — at capacity a release was already unrecoverable, so
the gate converts a destructive self-inflicted dead-end into a stable one, and no
escape hatch is warranted (the terminal state is D3's, and `member-slot-release` is
its home); the 503 taxonomy after `findCommittedClaim` and why the copy's
over-caution costs near zero (in the definite-failure cases the homepage degrades to
anonymous, so there is no form and no message to the couple); the eager probe cannot
precede `document.cookie` (the trail initialises from a custom element's
`connectedCallback` in a deferred module script, and the cookie was set by a prior
navigation), cannot double-fire, and has no interaction with `adaptive-media-tiering`
(`data-tier` gates media only and never fetches); `ops/README.md`'s insertion is
well-formed with no orphaned or duplicated heading; `NOTE.md`'s "a release does not
free the slot" is correct against `[id].ts` and the schema; `[id].ts`'s capacity gate
keying on the _link_ id rather than the cookie's parent is correct.

### Re-verification after round 4

`check-types` 0 errors · `oxlint` clean (same two pre-existing warnings in untouched
files) · `validate --strict` valid · `db:generate` no drift · `origin-guard.spec.ts`
**6/6** and mutation-verified for both the removed-guard and guard-below-side-effect
cases plus the re-enabled-`checkOrigin` case. Runtime **22/22**: guard-before-
authorisation on `guest-photos` and `rsvp` (403 cross-origin vs 409 same-origin, with
the uniform body), all six homepage identity renders (group with a slot, group at
capacity, full-group member, individual, anonymous, and the absence of every group
affordance where it should not appear), no synthetic `group quota unavailable` log
line, `group_full` on the 3rd claim, exactly 2 member rows. Server stopped, launcher
and temp removed, port free; the user's `:4321` dev server untouched.

## Fifth review round — SELF-REVIEW, not independent

The `code-reviewer` subagent failed twice with "upstream chain exhausted" (six
auto-retries total across both attempts), so no independent fifth opinion exists.
What follows is my own sweep of the same mandate, and it should be weighted
accordingly: **self-review cannot catch a wrong assumption I already hold**, which is
the main thing rounds 1–4 bought. Mandate B6/B8 and C10 were reached; B (admin
arithmetic, DB CHECK SQL, cookie math) was reached; parts of C9 were reached. Nothing
here should be read as confirmation from a second party.

### Found and fixed

- **C9 — the admin validation codes were unnamed in the normative delta.**
  `specs/group-invitations/spec.md:35` said only "Validation failures SHALL return
  `400` with a specific error code", while the code emits three distinct ones for
  admin creation (`invalid_type`, `invalid_max_members`, `invalid_parent_id`). Task
  6.3 said "validation failures" with no codes. A test author working from the
  artifacts — which is the stated plan for the deferred pass — would have had to read
  the source to guess two of three. `SPEC.md:51` already listed all six correctly;
  the delta and 6.3 now match it, and 6.3 also records the non-obvious half (an
  explicit `null` for `maxMembers`/`parentId` is _accepted_, not rejected — the
  round-2 L1 rewording).
- **A2 — one stale overclaim survived round 4's N2 fix.** `[id].ts:137` still said
  the capacity gate "closes the history-replay hole". Round 4 corrected that claim in
  `design.md`, `SPEC.md`, and the spec delta but not in the code comment, which is
  where a maintainer is most likely to read it. Now "narrows — though it does not
  close", with the `maxMembers=5`-with-3-claimed counterexample and a pointer to
  `release-via-post`. A repo-wide grep confirms no other instance.

### Checked and clean

- **A1/A3 dead code:** `parentGroupFull` is still load-bearing (used inside
  `releaseHref`); `claim.ts`'s local `json()` is used 8×; `groupAtCapacity` is used by
  `canClaimSlot`. Nothing orphaned.
- **A4 the round-4 `index.astro` reset** nulls exactly the five `invite*` variables —
  byte-for-byte the same set as the outer `catch`, and exactly the five props
  `<RsvpSection>` receives. No variable missed, so no stale state can leak into the
  anonymous render.
- **A5 both repair sites** (the dropped `const sticky = …` line in `[id].ts`, the
  duplicated brace in `RsvpSection.astro`) are structurally correct: brace and paren
  balance is `+0` across all five heavily-edited files, and `releaseRequested` is
  correctly `let` for the capacity gate's reassignment.
- **A6 `.astro` frontmatter:** neither `oxlint` nor `astro check` covers it
  (`noUnusedLocals` is not set), so this was checked by hand — all nine frontmatter
  consts in `RsvpSection.astro` have ≥2 references.
- **B5 admin GET aggregation arithmetic — sound, and the key property is provable:**
  `rsvps.invite_id` is the PRIMARY KEY and `guest_photos.invite_id` is UNIQUE (plus a
  unique index), so both LEFT JOINs are at-most-one-row and **cannot fan out**. That
  is what makes `claimedCount = members.length` a true count rather than an inflated
  one. `attending === true` / `=== false` correctly separates confirmed from declined
  and both from "no RSVP row" (`null` via the LEFT JOIN); `photoCount` counts rows, not
  files, consistent with how individuals are reported; `membersByParent` keys on
  `row.parentId` so a member cannot be attributed to the wrong group, and
  `invites_member_shape_chk` guarantees a member is never itself a group.
- **B6 `me.ts` privacy — sound:** `group` is included only when `invite.group` is
  truthy, and `resolveInvite` populates it only for `kind === "group"`. A member
  response is exactly `{ displayName, kind: "member" }` — no parent group id, no
  quota, no sibling information.
- **B7 the CHECK SQL under three-valued logic — sound, for a reason worth recording:**
  `CHECK(type IN ('individual','group'))` would NOT reject a NULL `type`, because
  `NULL IN (…)` evaluates to NULL and a CHECK passes on anything that is not FALSE.
  The same hole would let `(NULL = 'group') = (max_members IS NOT NULL)` evaluate to
  NULL and pass. Both are closed at the column level, not by the CHECK: `type` is
  `text NOT NULL DEFAULT 'individual'`. So the biconditional never sees a NULL
  operand. Constraint names in `0000_initial.sql` match all four cited in the spec
  deltas; `invites_parent_id_idx` is the index `readGroupQuota`'s correlated subquery
  needs; the self-FK is `ON DELETE no action`, matching `ops/MODERATION.md`.
- **B8 cookie arithmetic — sound:** `toCookieMaxAgeSeconds` is `Math.max(1, Math.floor(days*86400))`,
  which would return **NaN** for a NaN input (`Math.max(1, NaN)` is NaN, not 1). That
  is unreachable: `INVITE_COOKIE_DAYS` is `z.coerce.number().int().positive().default(30)`,
  so NaN, 0, negatives, and fractions all fail at startup. The sliding re-set in
  `[id].ts` always applies the full `maxAge` from `inviteCookieOptions()`, so it can
  never shorten a member's expiry. And the spec's "identical cookie attribute set"
  requirement is provable: exactly two Set-Cookie writers exist in the whole app
  (`[id].ts:157`, `claim.ts:90`), both via `setInviteCookie`.
- **C10 error-code inventory:** every code the app emits was cross-checked against the
  specs. The photo codes (`empty_photo`, `invalid_photo_type`, `photo_too_large`,
  `too_many_photos`, `invalid_body`) are documented in the base `guest-photos` /
  `rsvp-responses` specs, not missing. No code is documented that the code does not
  emit.

### Noted, deliberately not fixed

`invite_list_failed` — the admin GET's `500` code — is documented **nowhere**: not in
`SPEC.md`, not in any spec. It is pre-existing (present in `HEAD`, untouched by this
change), so documenting it here would be scope creep into another capability's
contract. Recorded so it is a decision rather than an oversight.

### Not reached

Mandate C10's full artifact read as a whole (heading hierarchy across all eleven
touched docs, scenario-to-requirement header matching beyond what
`validate --strict` checks), and a second-party re-examination of everything above.
`openspec validate --strict` does verify delta structure and requirement-header
matching, and it passes.

### Gates after round 5

`check-types` 0 errors · `oxlint` clean (same two pre-existing warnings) ·
`validate --strict` valid · `db:generate` no drift · `origin-guard.spec.ts` 6/6.
Progress **30/41**, same 11 deferred test tasks.

## Fifth review round — INDEPENDENT PASS COMPLETED (supersedes the self-review above)

The `code-reviewer` subagent was resumed after its two upstream failures and
completed the full mandate. It independently re-derived everything from source rather
than trusting the sections above, and **corroborated every clean result the
self-review reported** — A1 dead code, A3 repair sites, A4 the five-variable reset,
B5 aggregation arithmetic (confirming the PK/UNIQUE no-fan-out argument), B6 `me.ts`
privacy, B7 the `NOT NULL` foreclosure of the three-valued-logic hole, B8 the cookie
single-source proof (it found exactly one `cookies.set` in the whole app, at
`invite-session.ts:70`, which is a stronger result than the two-writer enumeration),
and C9's "nothing broken beyond the known `rsvp-api.spec.ts:121`" across five
existing spec files.

It also found **four Mediums the self-review missed entirely** — which is the
expected outcome and the reason an independent pass was worth waiting for. Three of
the four are the same class: _edits recorded as applied that are not in the tree, or
normative text a later code change silently contradicted._

### M1 — FIXED: two artifacts still specified the pre-round-4 guard order

`SPEC.md:67` said `guest-photos` returns `409 claim_required` "before any origin,
body, or storage handling", and `tasks.md` 4.2 said "before origin/multipart
handling". Round 4's L6 fix deliberately reversed exactly that: the guard is at
`guest-photos/index.ts:63`, the `claim_required` check at `:69`. Both artifacts
therefore mandated an ordering the code no longer implements. The concrete harm was
specific: a deferred-pass implementer writing task 4.3 while also sending a
cross-origin `Origin` (per the invite-session delta's own scenario) would observe
`403`, conclude the code had regressed, and "fix" it back to the order round 4
reversed. Both corrected, and 4.2 now states _why_ the order matters (group state is
not disclosed to a foreign origin).

### M2 — FIXED: the rsvp-section delta normatively mandated the element shape the change's own security analysis rejected

Nine occurrences across the delta's requirement paragraph and three scenarios, plus
`SPEC.md:26`, all said "release **link**". Round 3's M2 established that an anchor is
bypassable by middle-click, context menu, iOS long-press, drag-to-bookmarks,
copy-link-address, and no-script taps — which is why the shipped control is
`<button data-release-control>` with the URL in `data-release-href`, and why
`tasks.md` 7.4 explicitly warns "NOT an anchor". On archive this delta would have
landed in `openspec/specs/rsvp-section/spec.md` as normative text requiring an
`<a href>`, so a future implementer working from the archived spec would reintroduce
the round-3 bypass. Reworded to "control" throughout, and the delta now carries the
negative requirement explicitly: it SHALL NOT be an anchor with a navigable `href`,
with the bypass list and the data-attribute/script-navigation mechanism stated. The
four code comments that also said "release link" were corrected in the same pass.

### M3 — FIXED, and this is a correction to the handoff itself

Round 3's L6 entry recorded three items as fixed. **Two of them were never applied.**

- `design.md:25` (Goals) still said "a shared browser can **always** reach a fresh
  group identity" — directly contradicted by the D2 capacity gate, which refuses
  `?fresh=1` at capacity. Worse, D4's round-3 amendment at `design.md:147` said the
  release control is withheld at capacity "— **see Goals**", pointing at a
  qualification that did not exist. The dangling cross-reference is now satisfied.
- `tasks.md:33` (5.1) still carried "(+ member `COUNT` when `type='group'`)", stale
  twice over: the COUNT moved into `readGroupQuota`, and it also runs for **member**
  cookies (the parent-quota lookup), not only for `type='group'`.

Only the third L6 item (the `index.astro` comment) actually landed, so round 3 applied
a partial edit batch and reported it as complete. **Process note, recorded because it
matters more than the two lines:** the handoff is the artifact later rounds use to
decide what is already closed, so a misreported fix silently removes that area from
every subsequent audit. Both were found only because round 5 re-derived the artifacts
from source instead of trusting the record.

### M4 — FIXED: task 3.4 prescribed a testing mechanism that does not exist

3.4 told the implementer to force the claim statement to throw via "injected failing
executor or closed DB, following the `photo-publication.spec.ts`
dependency-injection pattern". That pattern works there because
`publishGuestPhoto(id, bytes, deps)` takes its publisher as a parameter;
`claimMemberSlot(group, displayName, now)` imports `db` at module level and has no
seam, and a Playwright spec cannot close the dev server's connection. Working only
from the artifacts, the implementer could not have expressed the load-bearing
"Storage failure is not a full group" scenario at all — the realistic outcomes were
skipping it or making an unplanned code change. Rewritten with a technique that does
work against `tests/support/dev-server.mjs`: hold `BEGIN EXCLUSIVE` on the test's own
connection to the same SQLite file so the server's claim INSERT fails `SQLITE_BUSY`,
assert `503` and no member row, then roll back. Adding a seam is noted as the
alternative and flagged as a code change rather than a test task.

### Lows and nits — all addressed

- **L1** `SPEC.md:13`'s uniform-404 rule had one real exception: `invite/opened`
  validates cookie _shape_ and lets its single-statement `UPDATE … RETURNING` discover
  existence, so a valid-shaped but unknown cookie plus a cross-origin `Origin` yields
  `403` where the other three endpoints `404` first. Not browser-reachable
  (`SameSite=Lax` withholds the cookie cross-site) and it discloses nothing about
  whether the id exists, since the refusal precedes the read. Documented in `SPEC.md`
  and in the invite-session delta rather than changed — DB-resolving first would add
  a read to a metrics endpoint hit on every reveal, for no user-visible gain.
- **L2** The capacity branch's copy asserts "Every spot has been claimed" but is also
  the fallthrough for `groupQuota === null`, where the truth is "unknown". Unreachable
  from `index.astro` (both branches degrade to anonymous, and `readGroupQuota` throws
  rather than returning null on a DB error), and failing closed this way is correct —
  the alternative would be the name-prompt form, which loops submit → 409 → reload.
  Documented in place rather than given separate UI for an impossible state.
- **L3** Task 7.4's release step would fail confusingly against _correct_ behaviour if
  the implementer reused 7.2's two-of-two fixture, since the D2 gate refuses
  `?fresh=1` at capacity. Now says to seed an open slot first.
- **L4** The capacity gate is read-then-act, not atomic: the last slot can fill between
  the quota read and the cookie write. Recorded as an accepted risk in `design.md` —
  the release writes nothing, the harm is bounded to one member losing an identity
  they could not have re-claimed anyway, and making it atomic would mean wrapping a
  redirect in a write transaction for no guest-visible gain. Pre-D2 there was no gate
  at all, so this is strictly better.

### Calibration note

The self-review and the independent pass agreed on every "clean" verdict and disagreed
on every finding: the self-review found two issues (the unnamed admin codes, one stale
comment) and missed all four Mediums. That is the expected shape of the blind spot
described in the previous section — residue from my own edit batches is precisely what
I am worst placed to see, because I read the files assuming my recorded edits landed.
Two of the four Mediums (M1, M3) were caused by my own earlier edits and reporting.

### Verification after round 5

`check-types` 0 errors (one intermediate breakage: an L2 explanatory comment placed
between `? (` and its element is invalid JSX — caught by `astro check`, moved inside
the `<div>`) · `oxlint` clean (same two pre-existing warnings) · `validate --strict`
valid · `db:generate` no drift · `origin-guard.spec.ts` 6/6. Runtime **12/12** on a
fresh temp DB after the JSX change: all five homepage identity renders plus the
absence assertions, and no compile errors in the server log. One harness bug of my own
was caught before drawing conclusions — the first attempt seeded `maxMembers: 1`, which
the 2–50 range check rejects, so every page rendered anonymous and looked like a
render failure; re-run with valid fixtures. Server stopped, launcher and temp removed,
ports free.

Progress **30/41**, same 11 deferred test tasks. All five rounds are now recorded.

## Fifth review round — INDEPENDENT PASS COMPLETED (supersedes the self-review above)

The `code-reviewer` subagent was resumed after its two upstream failures and completed the full mandate. It independently re-derived everything from source rather than trusting the sections above, and **corroborated every clean result the self-review reported** — A1 dead code, A3 repair sites, A4 the five-variable reset, B5 aggregation arithmetic (confirming the PK/UNIQUE no-fan-out argument), B6 `me.ts` privacy, B7 the `NOT NULL` foreclosure of the three-valued-logic hole, B8 the cookie single-source proof (it found exactly one `cookies.set` in the whole app, at `invite-session.ts:70`, which is a stronger result than my two-writer enumeration), and C9's "nothing broken beyond the known `rsvp-api.spec.ts:121`" across five existing spec files.

It also found **four Mediums the self-review missed entirely** — which is the expected outcome, and the reason an independent pass was worth waiting for. Three of the four are the same class: _edits recorded as applied that are not in the tree, or normative text a later code change silently contradicted._

### M1 — FIXED: two artifacts still specified the pre-round-4 guard order

`SPEC.md:67` said `guest-photos` returns `409 claim_required` "before any origin, body, or storage handling", and `tasks.md` 4.2 said "before origin/multipart handling". Round 4's L6 fix deliberately reversed exactly that: the guard is at `guest-photos/index.ts:63`, the `claim_required` check at `:69`. Both artifacts therefore mandated an ordering the code no longer implements.

The concrete harm was specific: a deferred-pass implementer writing task 4.3 while also sending a cross-origin `Origin` (per the invite-session delta's own scenario) would observe `403`, conclude the code had regressed, and "fix" it back to the order round 4 reversed. Both corrected, and 4.2 now states _why_ the order matters — group state is not disclosed to a foreign origin.

### M2 — FIXED: the rsvp-section delta normatively mandated the element shape the change's own security analysis rejected

Nine occurrences across the delta's requirement paragraph and three scenarios, plus `SPEC.md:26`, all said "release **link**". Round 3's M2 established that an anchor is bypassable by middle-click, the context menu, iOS long-press, drag-to-bookmarks, copy-link-address, and no-script taps — which is why the shipped control is `<button data-release-control>` with the URL in `data-release-href`, and why `tasks.md` 7.4 explicitly warns "NOT an anchor".

On archive this delta would have landed in `openspec/specs/rsvp-section/spec.md` as normative text requiring an `<a href>`, so a future implementer working from the archived spec would reintroduce the round-3 bypass. Reworded to "control" throughout, and the delta now carries the negative requirement explicitly: it SHALL NOT be an anchor with a navigable `href`, with the bypass list and the data-attribute/script-navigation mechanism stated. The four code comments that also said "release link" were corrected in the same pass.

### M3 — FIXED, and this is a correction to the handoff itself

Round 3's L6 entry recorded three items as fixed. **Two of them were never applied.**

- `design.md:25` (Goals) still said "a shared browser can **always** reach a fresh group identity" — directly contradicted by the D2 capacity gate, which refuses `?fresh=1` at capacity. Worse, D4's round-3 amendment at `design.md:147` said the release control is withheld at capacity "— **see Goals**", pointing at a qualification that did not exist. The dangling cross-reference is now satisfied.
- `tasks.md:33` (5.1) still carried "(+ member `COUNT` when `type='group'`)", stale twice over: the COUNT moved into `readGroupQuota`, and it also runs for **member** cookies (the parent-quota lookup), not only for `type='group'`.

Only the third L6 item (the `index.astro` comment) actually landed, so round 3 applied a partial edit batch and reported it as complete.

**Process note, recorded because it matters more than the two lines:** the handoff is the artifact later rounds use to decide what is already closed, so a misreported fix silently removes that area from every subsequent audit. Both were found only because round 5 re-derived the artifacts from source instead of trusting the record.

### M4 — FIXED: task 3.4 prescribed a testing mechanism that does not exist

3.4 told the implementer to force the claim statement to throw via "injected failing executor or closed DB, following the `photo-publication.spec.ts` dependency-injection pattern". That pattern works there because `publishGuestPhoto(id, bytes, deps)` takes its publisher as a parameter; `claimMemberSlot(group, displayName, now)` imports `db` at module level and has no seam, and a Playwright spec cannot close the dev server's connection.

Working only from the artifacts, the implementer could not have expressed the load-bearing "Storage failure is not a full group" scenario at all — the realistic outcomes were skipping it or making an unplanned code change. Rewritten with a technique that does work against `tests/support/dev-server.mjs`: hold `BEGIN EXCLUSIVE` on the test's own connection to the same SQLite file so the server's claim INSERT fails `SQLITE_BUSY`, assert `503` and no member row, then roll back. Adding a seam is noted as the alternative and flagged as a code change rather than a test task.

### Lows and nits — all addressed

- **L1** `SPEC.md:13`'s uniform-404 rule had one real exception: `invite/opened` validates cookie _shape_ and lets its single-statement `UPDATE … RETURNING` discover existence, so a valid-shaped but unknown cookie plus a cross-origin `Origin` yields `403` where the other three endpoints `404` first. Not browser-reachable (`SameSite=Lax` withholds the cookie cross-site) and it discloses nothing about whether the id exists, since the refusal precedes the read. Documented in `SPEC.md` and the invite-session delta rather than changed — DB-resolving first would add a read to a metrics endpoint hit on every reveal, for no user-visible gain.
- **L2** The capacity branch's copy asserts "Every spot has been claimed" but is also the fallthrough for `groupQuota === null`, where the truth is "unknown". Unreachable from `index.astro` (both branches degrade to anonymous, and `readGroupQuota` throws rather than returning null on a DB error), and failing closed this way is correct — the alternative would be the name-prompt form, which loops submit → 409 → reload. Documented in place rather than given separate UI for an impossible state.
- **L3** Task 7.4's release step would fail confusingly against _correct_ behaviour if the implementer reused 7.2's two-of-two fixture, since the D2 gate refuses `?fresh=1` at capacity. Now says to seed an open slot first.
- **L4** The capacity gate is read-then-act, not atomic: the last slot can fill between the quota read and the cookie write. Recorded as an accepted risk in `design.md` — the release writes nothing, the harm is bounded to one member losing an identity they could not have re-claimed anyway, and making it atomic would mean wrapping a redirect in a write transaction for no guest-visible gain. Pre-D2 there was no gate at all, so this is strictly better.

### Calibration note

The self-review and the independent pass agreed on every "clean" verdict and disagreed on every finding: the self-review found two issues (the unnamed admin codes, one stale comment) and missed all four Mediums. That is the expected shape of the blind spot described in the previous section — residue from my own edit batches is precisely what I am worst placed to see, because I read those files assuming my recorded edits had landed. Two of the four Mediums (M1, M3) were caused by my own earlier edits and reporting.

### Verification after round 5

`check-types` 0 errors (one intermediate breakage: an L2 explanatory comment placed between `? (` and its element is invalid JSX — caught by `astro check`, moved inside the `<div>`) · `oxlint` clean (same two pre-existing warnings) · `validate --strict` valid · `db:generate` no drift · `origin-guard.spec.ts` 6/6.

Runtime **12/12** on a fresh temp DB after the JSX change: all five homepage identity renders plus the absence assertions, and no compile errors in the server log. One harness bug of my own was caught before drawing conclusions — the first attempt seeded `maxMembers: 1`, which the 2–50 range check rejects, so every page rendered anonymous and looked like a render failure; re-run with valid fixtures. Server stopped, launcher and temp removed, ports free.

Progress **30/41**, same 11 deferred test tasks. All five rounds are now recorded.
