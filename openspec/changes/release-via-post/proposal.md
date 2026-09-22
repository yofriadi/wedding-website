# Convert the invite identity release from GET to POST

## Why

`GET /{groupId}?fresh=1` releases a claimed member back to the shared group identity. It is a **state-changing GET**, and that shape has two consequences that no amount of gating fully removes:

1. **It enters browser history and omnibox autocomplete.** Re-opening a history entry sends `Sec-Fetch-Site: none`, which the release gate _must_ allow — `none` is also how a guest arrives after pasting a link into the address bar, and refusing it would break a legitimate path. `Cache-Control: no-store` prevents caching, not history.
2. **The response cannot tell the guest who they just released.** A GET redirect to `/` re-renders the homepage, which then shows the group identity — but the guest gets no confirmation of _which_ member they gave up, on a shared browser where that is the whole point of the control.

The release is currently protected by two gates in `apps/web/src/pages/[id].ts`: a Sec-Fetch check (`Sec-Fetch-Site` of `same-origin`/`none` plus `Sec-Fetch-Dest` of `document`) and a capacity check (refused when the group has no open slot). The capacity gate is what actually neutralises the history-replay hazard today — because a release does **not** delete the member row, a guest who releases and re-claims leaves the group full, so the replayed entry is refused. That is a real mitigation but it is incidental and **partial**: it depends on the re-claim filling the last slot, and it does not hold for a group that still has room — at `maxMembers=5` with 3 claimed, a replayed `?fresh=1` from history, or a shared browser's second user, still destroys the identity.

A POST is the structural fix: no history entry, not replayable by navigation, and a response body that can name the released member.

## What changes

- New `POST /api/invite/release` (or extend `POST /api/invite/claim` with `{ action: "release" }` — decide during design; a separate endpoint keeps the claim path's atomic quota statement untouched and is easier to reason about).
- The endpoint resolves identity from the cookie, verifies the member belongs to the group it is being released to, rebinds `ww_invite_id` to the parent group id with the standard cookie attribute set, bumps the group row's seen-metrics exactly as `?fresh=1` does today, and returns `no-store` JSON naming the released member's `displayName`.
- `GET /{groupId}?fresh=1` behaviour: decide whether to keep it as a redirecting alias (for old links already in the wild and in browser history) or remove it. Keeping it means the Sec-Fetch and capacity gates stay load-bearing; removing it means old history entries 404, which is arguably the better outcome but is a visible change.
- `RsvpSection.astro` swaps `window.location.assign(releaseHref)` for a `fetch`, then reloads — the same pattern the claim handler already uses, so the surface stays consistent. The two-step confirmation and its minimum dwell interval are unchanged.
- It must carry the proxy-aware origin guard (`isSameOriginRequest` from `lib/same-origin.ts`) like every other cookie-authenticated POST. Note that `tests/origin-guard.spec.ts` will not simply absorb a new endpoint: it asserts an **exact** route inventory, so the implementer must add the route to that list as well as the guard — and the scan only covers route files under `src/pages`, so an endpoint placed elsewhere would be invisible to it.
- `design.md` decision D4 in `group-invitations` records the GET choice and its rationale ("reuses the existing link semantics … no new endpoint"). This change reverses that decision and must update D4 rather than silently contradict it.

## Constraints carried over from the current implementation

- A release SHALL NOT delete the member row, and SHALL NOT free the slot. The member's RSVP, photo, and metrics stay intact under the original cookie.
- A release SHALL be refused when the group has no open slot, or when its quota cannot be read (fail closed).
- A refused or failed release SHALL leave the member identity intact — the sticky rule is the fallback.
- Cookie attributes must come from the single source of truth (`inviteCookieOptions()` / `setInviteCookie()` in `lib/invite-session.ts`), not be restated.

## Context for whoever picks this up

Filed from the third adversarial review round of `group-invitations`; the owner chose "capacity gate now, POST conversion as an immediate follow-up". The Sec-Fetch gate, the capacity gate, and the button-not-anchor client control are all already implemented and verified — see `openspec/changes/group-invitations/handoff.md`, sections "Second adversarial review round" (H1, M2) and "Third adversarial review round" (D2). Those gates should stay in place regardless of this change: POST removes the history-replay vector but not the cross-site one.
