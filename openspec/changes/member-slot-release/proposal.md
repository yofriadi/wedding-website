# A designed procedure for releasing a member slot

## Why

A group invite has a hard quota (`max_members`, 2–50). Slots are consumed by minting a member row, and **nothing ever gives one back**. Three situations produce a member row that the couple will want removed:

1. **One person claiming from several browsers.** Inherent to cookie identity: each browser holds its own member id, so the same guest on a phone and a laptop is two slots. `ops/MODERATION.md` already tells the couple this is expected and visible in the admin list's per-group `members[]` breakdown.
2. **A claim that committed but lost its response.** If the process dies or the connection resets after the member row is inserted but before the response reaches the browser, the guest never receives the `Set-Cookie` and still looks unclaimed. Their retry mints a second row. (The client no longer encourages that retry — `AMBIGUOUS_CLAIM_COPY` fires on any 5xx and on a thrown fetch, telling the guest to reload once and then ask rather than retry blind — but copy can only reduce the rate, not eliminate it.) `findCommittedClaim()` in `lib/group-claim.ts` closes the narrower case where the handler survives to observe the failure; the crash case cannot be closed server-side, because nothing runs to reconcile.

3. **A member who wants out, or who claimed with the wrong name, while the group is at capacity.** This one is new and is a direct consequence of the D2 capacity gate: the release affordance is withheld and the server refuses `?fresh=1` when no slot is open, so the guest has _no_ self-service escape — correctly, since releasing at capacity could never be undone by re-claiming, but it leaves the row stuck. Before the gate this case was merely bad (release stranded the member); now it is unreachable from the guest side entirely, which makes a couple-side procedure the only remedy. It is the strongest argument for this change.

Today the only remedy is hand-editing the database, and `ops/MODERATION.md` explicitly says not to improvise one. So a duplicate permanently reduces a family's quota, with a `max_members` of 2 meaning the family loses half its capacity.

## The blocker that makes this need designing, not just documenting

`invites.parent_id` is a self-referencing foreign key with `ON DELETE no action`, and foreign keys are enabled. So:

- Deleting a **member** who has an `rsvps` or `guest_photos` row **fails** on the child FK.
- Deleting a **group** that still has members fails for the same reason.

That backstop is deliberate and correct — it stops a group being deleted out from under its members — but it means "just delete the duplicate row" does not work for any member who has actually used the site, which is exactly the member worth keeping. A procedure has to decide what happens to the RSVP and the photo, in what order, and who is allowed to do it.

## What changes

Decide and implement a reviewed slot-release path. Options to evaluate during design:

- **An admin endpoint** (`DELETE /api/admin/{token}/invites/{id}`, or an action on the existing admin route) that releases one member slot under the token's authority, with an explicit policy for the member's RSVP and photo: reassign to nothing (delete both, in FK order), or keep the photo and drop the RSVP, or refuse when either exists and require a prior step.
- **A documented manual procedure** in `ops/MODERATION.md` with the exact statement order (photo file and row, then `rsvps`, then the member row), a pre-flight backup step matching `ops/README.md`, and an explicit warning about the guest's orphaned cookie — a released member whose browser still holds the old id resolves to `not_found` and degrades to anonymous, which is safe but will look like their RSVP vanished.
- **Whether the released member's cookie should be rebound** to the parent group id on their next visit, so they land in the claim flow rather than as an anonymous visitor.

Whichever is chosen, it needs a test proving the FK order works and that the group's `claimedCount` (always derived from a `COUNT` of member rows, never stored) drops by exactly one.

## Constraints

- **Do not make claiming idempotent on `(group, displayName)`.** That was considered and rejected during `group-invitations`: it would let one guest bind to another's identity by guessing their name, which is a worse failure than a wasted slot.
- Any release path must be token-gated like the rest of the admin API, and must not be reachable from a guest cookie.
- The atomic quota statement in `claimMemberSlot()` must stay the only writer able to consume a slot; a release path gives slots back, it does not allocate them.
- Guest display names are private (`ops/MODERATION.md`): whatever UI or logging this adds must not leak one member's name to another.

## Context for whoever picks this up

Filed from the third adversarial review round of `group-invitations`. The owner chose "accept the residual risk now, reword the 503 copy, designed slot-release as a future change". The reworded copy already shipped: `AMBIGUOUS_CLAIM_COPY` in `apps/web/src/components/RsvpSection.astro` tells a guest whose claim outcome is unknown not to keep retrying, to reload once, and then to ask rather than retry blind — because they cannot self-check (member names are private). That reduces how often this procedure is needed but does not remove the need. See `openspec/changes/group-invitations/handoff.md` and the `design.md` risk-register entry for the full reasoning.

Related: `release-via-post` (also filed from the same review round) is about giving a slot _up_ voluntarily from the guest side; this change is about the couple reclaiming one.
