# group-invitations Specification

## Purpose

Group invitations: one shareable link for a family or party where each visitor can claim an independent member slot — own display name, own RSVP, own photo — capped by an admin-set quota. Members are child rows in the existing `invites` table, so the RSVP and guest-photo persistence contracts apply per member unchanged.

## ADDED Requirements

### Requirement: Group and member invites share the invites table

The `invites` table SHALL gain `parent_id` (nullable text, self-referencing FK to `invites.id`), `type` (text, NOT NULL, default `"individual"`, one of `"individual"` | `"group"`), and `max_members` (nullable integer), plus an index on `parent_id`. A **group invite** is a row with `type = "group"` and a non-null `max_members`; a **member invite** is a row with `type = "individual"` and a non-null `parent_id`; a standalone individual invite has `type = "individual"` and `parent_id IS NULL`. The schema SHALL reject (via CHECK constraints) a group row without `max_members`, a non-group row with `max_members`, a group row with a `parent_id`, and `max_members` outside 2–50. Member rows SHALL be created only through the claim flow — never directly through the admin endpoint. The `rsvps` and `guest_photos` tables SHALL NOT change: per-member RSVP and photo slots fall out of their existing `invite_id` primary-key/unique constraints. The baseline-migration artifact that carries these columns is owned by the `database-baseline` capability.

#### Scenario: Group row shape enforced

- **WHEN** a row is inserted with `type = "group"` and NULL `max_members`, or `max_members` outside 2–50, or a non-null `parent_id`
- **THEN** the database rejects it with a CHECK constraint error (surfacing as a CHECK failure, not misclassified as an id collision)

#### Scenario: Member row references its group

- **WHEN** a member row is inserted with `parent_id` set to an existing group invite id
- **THEN** it is accepted with `type = "individual"` and NULL `max_members`, and a query of `invites WHERE parent_id = <group>` returns exactly the group's members

#### Scenario: Group with members cannot be deleted

- **WHEN** a group invite row with at least one member row is deleted with foreign keys enabled
- **THEN** the self-referencing foreign key rejects the delete

#### Scenario: Rows without explicit group fields read as standalone individuals

- **WHEN** a row is inserted without `type` or `parent_id` (column defaults apply)
- **THEN** it reads as a standalone individual (`type = "individual"`, `parent_id IS NULL`) and behaves exactly as individual invites did before this change

### Requirement: Admin creates group invites

`POST /api/admin/:token/invites` SHALL accept an optional `type` (`"individual"` | `"group"`, default `"individual"`) and an optional `maxMembers`. A group creation SHALL require an integer `maxMembers` between 2 and 50 inclusive; an individual creation SHALL NOT carry a non-null `maxMembers` (an explicit `null` is equivalent to omitting it). A non-null `parentId` SHALL be rejected on any creation — member rows are minted only by the claim endpoint, so that the atomic quota statement stays the only writer able to consume a slot. The 201 response for a group SHALL include `id`, `sharePath`, `type: "group"`, and `maxMembers`; the individual response shape is unchanged apart from `type`. Validation failures SHALL return `400` with a specific error code — `invalid_json`, `display_name_required`, `display_name_too_long`, `invalid_type`, `invalid_max_members`, or `invalid_parent_id` — matching `SPEC.md`'s admin contract exactly. Token gating and bare-404 behavior are unchanged.

#### Scenario: Create a group invite

- **WHEN** an authorized POST body is `{ "displayName": "The Smith Family", "type": "group", "maxMembers": 6 }`
- **THEN** the response is `201` with `{ id, sharePath: "/<id>", type: "group", maxMembers: 6 }` and the stored row is a group invite with zero members

#### Scenario: Group without quota rejected

- **WHEN** the body has `type: "group"` but a missing, non-integer, or out-of-range `maxMembers`
- **THEN** the response is `400` with `{ "error": "invalid_max_members" }` and no row is created

#### Scenario: Individual with quota rejected

- **WHEN** the body omits `type` (or sets `"individual"`) but includes a non-null `maxMembers`
- **THEN** the response is `400` with a specific error and no row is created

#### Scenario: Member rows not creatable via admin

- **WHEN** an authorized POST attempts to set a non-null `parentId`, or a `type` outside `"individual"` | `"group"`
- **THEN** the response is `400` and no row is created

### Requirement: Claim a member slot by name

The system SHALL expose `POST /api/invite/claim` that resolves identity from the `ww_invite_id` request cookie (never URL or body) BEFORE parsing the request body, and — when the cookie maps to a group invite — atomically creates one member invite under that group and rebinds the cookie to the new member id via `Set-Cookie` with attributes identical to the invite-link cookie (`httpOnly: false`, `path: "/"`, `sameSite: "lax"`, `secure` in production, `maxAge` derived from `INVITE_COOKIE_DAYS`). The body SHALL be JSON `{ "displayName": string }`, trimmed, 1–120 characters; when the resolved identity is a group, an invalid body returns `400` after identity resolution. A member identity receives the idempotent `200` regardless of body content, since its slot is already claimed and no name is taken from the request. A successful first claim returns `201` with `{ "displayName": string, "kind": "member" }` and no invite id in the body. Missing, malformed, or unknown cookies produce the uniform bare `404` indistinguishable from `GET /api/invite/me` not-found; a valid cookie for a standalone individual invite returns `409` with `{ "error": "not_a_group" }`. A request presenting a cross-origin `Origin` header returns `403` with `{ "error": "cross_origin_post" }` — placed after identity resolution so an anonymous caller still gets the bare `404`, and proxy-aware so a TLS-terminating reverse proxy does not make every legitimate claim look cross-origin. Every response carries `Cache-Control: no-store`. The claim SHALL NOT modify `seen_at`/`seen_count`/`opened_at`/`opened_count` on the group or the new member row, and the member row starts with the same default metrics state as a fresh individual invite.

#### Scenario: Cross-origin claim is refused

- **WHEN** a claim POST presents an `Origin` header that is not this site's public origin
- **THEN** the response is `403` with `{ "error": "cross_origin_post" }` and no member row is created

#### Scenario: First claim mints a member and rebinds the cookie

- **WHEN** a visitor whose cookie is a group id POSTs `{ "displayName": "Alex" }` to `/api/invite/claim` and the group is below quota
- **THEN** the response is `201` with `{ "displayName": "Alex", "kind": "member" }`, a `Set-Cookie` rebinds `ww_invite_id` to the new member id with the full invite-link attribute set (readable from `document.cookie`), and a member row exists with `parent_id` = the group and `display_name = "Alex"`

#### Scenario: Claimed member can act immediately

- **WHEN** a claim response has been received and the rebound cookie is used on `GET /api/invite/me`, `POST /api/rsvp`, or `POST /api/guest-photos`
- **THEN** each behaves exactly as it does for a standalone individual invite under the member's own identity

#### Scenario: Re-claim by an existing member is idempotent

- **WHEN** a visitor whose cookie already maps to a member invite POSTs to `/api/invite/claim`
- **THEN** the response is `200` with that member's own `{ displayName, kind: "member" }`, no new member row is created, and the cookie is unchanged

#### Scenario: Anonymous or invalid caller

- **WHEN** the endpoint is called with no cookie, a malformed cookie value, or an unknown id — with any body, valid or not
- **THEN** the response is `404` with the identical bare shape in all cases

#### Scenario: Standalone individual cannot claim

- **WHEN** the cookie maps to an individual invite with no parent
- **THEN** the response is `409` with `{ "error": "not_a_group" }` and no row is created

#### Scenario: Invalid body after valid group identity

- **WHEN** the cookie maps to a group invite but the body is not valid JSON or `displayName` fails validation
- **THEN** the response is `400` with a specific error and no member row is created

#### Scenario: Storage failure is not a full group

- **WHEN** the claim insert fails for an operational reason (including `SQLITE_BUSY`)
- **THEN** the response is `503` (retryable), no member row is created, and the failure is never reported as `group_full`

### Requirement: Slot claiming enforces the quota atomically

The member-row insert SHALL be a single atomic statement whose insert is conditioned on the group's current member count being below its `max_members` (an `INSERT … SELECT … WHERE` with a member-count subquery, or an equivalent serialized transaction), returning the new row on success. Read-then-write sequences outside one statement/transaction SHALL NOT be used. When the group already has `max_members` members, the claim SHALL insert nothing and return `409` with `{ "error": "group_full" }`; `group_full` is reserved for a successfully executed statement that inserted zero rows while the group row still exists. Under concurrent claims, the number of member rows for a group SHALL never exceed `max_members`.

#### Scenario: Quota boundary

- **WHEN** a group with `maxMembers = 2` already has 2 members and another visitor claims
- **THEN** the response is `409` with `{ "error": "group_full" }` and the group still has exactly 2 member rows

#### Scenario: Concurrent claims never over-allocate

- **WHEN** five claims for the same group with `maxMembers = 3` arrive simultaneously
- **THEN** the group never exceeds 3 member rows (and ends with exactly 3 when no claim returns `503`), at most three claims succeed with distinct member ids, and every non-successful claim receives `409 group_full` or a retryable `503`

#### Scenario: Last slot race

- **WHEN** two claims race for a group's final open slot
- **THEN** at most one succeeds and any other receives `409 group_full` or a retryable `503`, with the group never exceeding `maxMembers` member rows (reaching exactly `maxMembers` only when the winner's insert succeeds)

### Requirement: Group link revisit keeps a claimed member identity with sliding expiry

When `GET /{id}` is requested with a group invite id and the request already carries a `ww_invite_id` cookie that maps to a member invite of that same group, the response SHALL re-set the cookie with the same member id and a freshly computed `Max-Age` (identity preserved, expiry sliding as today) rather than rebinding to the group id. In all other cases the existing rebind rule applies unchanged: the cookie is set to the link's invite id. Seen-metrics on the group invite row (the link id) are bumped on every visit regardless of cookie state, as today. The sticky determination SHALL remain correct even when the metrics write has failed (the degraded read path must also learn the invite's type).

#### Scenario: Member revisits their group link

- **WHEN** a visitor who has claimed a member slot opens the group link again
- **THEN** the response re-sets `ww_invite_id` to their member id with a fresh `Max-Age` (never the group id) and the group row's `seen_count` increments by one

#### Scenario: Fresh visitor to a group link gets the group cookie

- **WHEN** a visitor with no cookie, an unknown cookie, or a cookie for a different invite opens the group link
- **THEN** the cookie is set (or rebound) to the group invite id, exactly as the existing rebind rule

#### Scenario: Member of another group follows this link

- **WHEN** a visitor whose cookie is a member of group A opens the link for group B
- **THEN** the cookie rebinds to group B's id and their group A member row is unaffected

### Requirement: Explicit fresh-identity release for shared browsers

`GET /{groupId}?fresh=1` SHALL bypass the sticky-member rule: the cookie rebinds to the group id exactly as for a fresh visitor, allowing a second person on a shared browser to reach the claim flow. The release SHALL create no rows and consume no slot, and SHALL leave the previously bound member row (and its RSVP/photo/metrics) untouched; the only write is the group row's seen-metrics, as for any link visit. The release is one-way for that browser: the member id lives only in the cookie, so after the rebind that browser can no longer act as the original member, and a subsequent claim from the same browser mints a NEW member row consuming another slot. Client surfaces SHALL present the release behind a two-step confirmation so an accidental tap or prefetch cannot downgrade an answered member. Seen-metrics on the group row are bumped as for any link visit.

Because the release is a state-changing GET it is exempt from origin checks altogether: safe methods are never inspected, and `SameSite=Lax` _sends_ the cookie on cross-site top-level navigations. The endpoint SHALL therefore honour `?fresh=1` only for a request that looks like a real visit to our own page — `Sec-Fetch-Site` of `same-origin` or `none`, and `Sec-Fetch-Dest` of `document` when either header is present. A refused release SHALL still redirect normally and SHALL fall back to the sticky rule, leaving the member identity intact. Requests carrying no `Sec-Fetch` metadata SHALL be allowed through, so older browsers, `curl`, and the manual walkthrough keep working; the two-step confirmation in the UI remains the primary gate. The `fresh` parameter SHALL have no effect on non-group invite links.

The release SHALL additionally be refused when the group has no open slot (`claimedCount >= maxMembers`) or when its quota cannot be read. At capacity the release is pure loss — the member id lives only in the cookie and re-claiming would need a slot that does not exist — so the server agrees with the UI's withheld control instead of honouring a hand-built URL. This narrows, but does not close, the history-replay hole that a GET release opens: `/{groupId}?fresh=1` enters browser history and omnibox autocomplete, and re-opening it sends `Sec-Fetch-Site: none`, which the gate above must allow. Because a release does not delete the member row, a member who releases and re-claims leaves the group full, so that replay is refused — but a group with room to spare still honours it. Closing the hole properly needs the release to stop being a GET (filed as `release-via-post`). The capacity gate SHALL fail closed: an unreadable quota refuses the release, because a destructive action must not proceed on unknown state.

#### Scenario: Second household member starts fresh

- **WHEN** a browser holding a member cookie for group G opens `/{G}?fresh=1`
- **THEN** the cookie rebinds to G's group id, no rows change, and the visitor can subsequently claim their own member slot

#### Scenario: Release does not destroy the original member

- **WHEN** a browser has released to the group identity via `?fresh=1`
- **THEN** the original member row, its RSVP, and its photo remain intact and the original member cookie value would still resolve

#### Scenario: Cross-site forced navigation cannot release a member

- **WHEN** a browser holding a member cookie is navigated to `/{G}?fresh=1` from another site (`Sec-Fetch-Site: cross-site`), or that URL is loaded as a subresource (`Sec-Fetch-Dest: image`)
- **THEN** the response is the normal redirect, the release is refused, and the member cookie is preserved

#### Scenario: Release refused when the group is full

- **WHEN** a browser holding a member cookie opens `/{G}?fresh=1` and G's `claimedCount` equals its `maxMembers`
- **THEN** the response is the normal redirect, the release does not occur, and the member cookie is preserved — including when the URL was replayed from browser history with `Sec-Fetch-Site: none`

#### Scenario: Fresh parameter ignored on individual links

- **WHEN** any visitor opens an individual invite link with `?fresh=1`
- **THEN** behavior is identical to the same link without the parameter

### Requirement: A full group stays browsable

Exhausting the quota SHALL NOT break the link: visitors can open the group link, receive the group cookie, browse the site, see the group greeting, and read public aggregates. Only slot-consuming actions are blocked: claim returns `409 group_full`, and RSVP/photo POSTs with a group cookie return `409 claim_required`. Client surfaces SHALL present a read-only "group is at capacity" state for group-cookie visitors when `claimedCount` equals `maxMembers`, and SHALL run the name-prompt claim flow before offering RSVP or photo upload to group-cookie visitors when slots remain.

#### Scenario: N+1 visitor browses normally

- **WHEN** a visitor opens a group link whose quota is full
- **THEN** the redirect, cookie, greeting, and homepage behave as for any invited visitor and `GET /api/invite/me` reports the group identity with `claimedCount` equal to `maxMembers`

#### Scenario: Blocked actions surface capacity, not breakage

- **WHEN** a group-cookie visitor of a full group attempts to claim, RSVP, or upload a photo
- **THEN** claim returns `409 group_full`, RSVP/photo return `409 claim_required`, no RSVP row, photo row, or member row is created, and the photo UI does not enter its upload-committed state

### Requirement: Member state is fully independent

Each member invite SHALL carry its own `display_name`, metrics, RSVP row, and photo row; an action performed under one member's cookie SHALL NOT read, overwrite, or expose another member's state. The public RSVP count counts attending member responses individually (a group contributes one count per attending member, never a group-level response). The group invite row itself SHALL never hold an `rsvps` or `guest_photos` row.

#### Scenario: Two members RSVP independently

- **WHEN** two members of one group submit different `attending` values
- **THEN** two distinct `rsvps` rows exist keyed by the two member ids, each read back only under its own cookie, and the public count reflects each attending member

#### Scenario: Two members upload photos independently

- **WHEN** two members of one group each upload a photo
- **THEN** two `guest_photos` rows exist keyed by the two member ids and each member's `mineId` resolves only their own photo

#### Scenario: Metrics stay per identity

- **WHEN** one member records opens via `/api/invite/opened`
- **THEN** only that member row's `opened_at`/`opened_count` change — the group row and sibling member rows are untouched

### Requirement: Admin list exposes group breakdown

`GET /api/admin/:token/invites` SHALL include every invite — standalone individuals, groups, and member rows — as top-level entries carrying `type` (and `parentId` for members) in addition to existing fields. Group entries SHALL additionally include `maxMembers`, `claimedCount` (current member count), `attendingCount` and `declinedCount` across members, `photoCount` across members, and a `members` array — ordered newest-claimant-first, inheriting the list's `createdAt DESC, id DESC` — with each member's `id`, `displayName`, `attending`, `openedAt`/`openedCount`, and photo presence (member `seen_*` metrics are omitted: they are normally zero because link metrics bump on the link id, though a member id used directly as a link would bump them). Standalone individual entries SHALL keep their existing flat shape (plus `type`). Token gating and bare-404 behavior are unchanged.

#### Scenario: Mixed list with breakdown

- **WHEN** an admin lists invites with one standalone individual and one group having two members (one attending, one with a photo)
- **THEN** the response contains exactly four top-level entries: the individual with `type: "individual"` and its existing fields, the group with `type: "group"`, `maxMembers`, `claimedCount: 2`, `attendingCount: 1`, `photoCount: 1`, and a two-element `members` array with the per-member details, and the two member rows with `type: "individual"` and their `parentId`

#### Scenario: Empty group lists cleanly

- **WHEN** an admin lists invites with a freshly created group
- **THEN** the group entry shows `claimedCount: 0`, zero RSVP/photo counts, and an empty `members` array
