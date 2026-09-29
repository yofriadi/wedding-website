# invite-session Specification (delta)

## MODIFIED Requirements

### Requirement: Resolve current invite from cookie

The system SHALL expose `GET /api/invite/me` that reads the `ww_invite_id` request cookie and, when it maps to an existing invite, responds `200` with JSON `{ "displayName": string, "kind": "individual" | "member" | "group" }`. When the invite is a group invite, the response SHALL additionally carry `"group": { "maxMembers": number, "claimedCount": number }` reflecting the group's quota and current member count; individual and member responses carry no `group` field. No other fields are returned.

#### Scenario: Valid cookie resolves

- **WHEN** `GET /api/invite/me` is sent with a `ww_invite_id` cookie whose value is an existing standalone individual invite id
- **THEN** the response is `200` with `{ "displayName": <the invite's display_name>, "kind": "individual" }` and no other fields

#### Scenario: Member cookie resolves to member identity

- **WHEN** the cookie value is an invite id whose row has a non-null `parent_id`
- **THEN** the response is `200` with `{ "displayName": <the member's own display_name>, "kind": "member" }` and no `group` field

#### Scenario: Group cookie resolves to group identity with quota state

- **WHEN** the cookie value is a group invite id with `maxMembers = 4` and two claimed members
- **THEN** the response is `200` with `{ "displayName": <the group's display_name>, "kind": "group", "group": { "maxMembers": 4, "claimedCount": 2 } }`

#### Scenario: No cookie

- **WHEN** `GET /api/invite/me` is sent without a `ww_invite_id` cookie
- **THEN** the response is `404` and the body shape is identical to any other not-found case

#### Scenario: Malformed cookie value

- **WHEN** the cookie value is not a syntactically valid invite id (wrong length or charset)
- **THEN** the response is `404` with the same body shape as an unknown id (no distinction from unknown)

#### Scenario: Unknown cookie value

- **WHEN** the cookie value is well-formed but no matching invite row exists
- **THEN** the response is `404` with the same body shape as the malformed case

#### Scenario: Lookup remains read-only for groups and members

- **WHEN** `GET /api/invite/me` is called with a group or member cookie any number of times
- **THEN** no metrics columns on the group, the member, or any sibling change

## ADDED Requirements

### Requirement: Cookie-authenticated mutations verify the request origin

Every endpoint that mutates state **in response to a non-safe method** on the strength of the `ww_invite_id` cookie SHALL verify that the request originates from this site before acting, using a comparison that survives a TLS-terminating reverse proxy. The one mutating GET — `GET /{groupId}?fresh=1` — is deliberately out of scope and cannot satisfy this rule: a cross-site top-level navigation carries no `Origin` header at all, so an origin comparison would pass it. It is guarded instead by the `Sec-Fetch` and capacity checks in the release requirement of the `group-invitations` capability, which are the equivalent protection for that shape. A request presenting a cross-origin `Origin` header SHALL be refused with `403` and body `{ "error": "cross_origin_post" }`; a request presenting no `Origin` header SHALL be allowed, so non-browser callers keep working. The check SHALL run after the endpoint's own identity check, so a caller with no usable cookie still receives the uniform bare `404`. Where the endpoint DB-resolves identity first (`rsvp`, `guest-photos`, `claim`), an unknown cookie `404`s before the guard; `invite/opened` validates cookie _shape_ only and lets its single-statement metrics update discover existence, so a valid-shaped but unknown cookie plus a cross-origin `Origin` yields `403` — a documented divergence that discloses nothing about whether the id exists, because the refusal precedes the read.

Astro's framework `security.checkOrigin` SHALL remain **disabled**. It compares `Origin` against `new URL(request.url).origin`, whose scheme is derived from `req.socket.encrypted`, so behind the documented Caddy deployment it can never match and every form-like or bodiless POST is rejected in production. It also cannot be corrected from config: the middleware is `unshift`ed ahead of user middleware, `site:` never reaches `new URL(request.url)`, and `security.allowedDomains` only feeds a validator the node adapter calls with `void 0` for the protocol. The check is therefore performed in application code (`lib/same-origin.ts`), reconstructing the public origin from `X-Forwarded-Proto`/`X-Forwarded-Host`. Endpoints whose authority is a secret in the path rather than an ambient cookie (`POST /api/admin/{token}/invites`) are exempt, since CSRF cannot supply the token.

#### Scenario: Cross-origin mutation is refused

- **WHEN** any cookie-authenticated POST is sent with an `Origin` header that is not this site's public origin
- **THEN** the response is `403` with `{ "error": "cross_origin_post" }` and no state changes

#### Scenario: Proxied same-origin mutation succeeds

- **WHEN** a POST arrives over plain HTTP from a TLS-terminating proxy carrying `Origin: https://<public-host>` plus matching `X-Forwarded-Proto`/`X-Forwarded-Host`
- **THEN** the request is treated as same-origin and is not refused

#### Scenario: The guard cannot be silently dropped

- **WHEN** a cookie-authenticated mutating endpoint is added without the origin check, or `security.checkOrigin` is re-enabled
- **THEN** `tests/origin-guard.spec.ts` fails
