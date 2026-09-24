# rsvp-section Specification (delta)

## MODIFIED Requirements

### Requirement: Server-rendered invitee controls

When the request carries a valid `ww_invite_id` cookie resolving to a standalone individual or member invite, the section SHALL render — in the server HTML — a single confirm-reservation submit button. The button SHALL submit `attending: true` to `POST /api/rsvp`; no attending/decline choice or headcount control SHALL be rendered. An invite holder whose stored response is `attending: true` SHALL see the button disabled in its confirmed presentation (confirmed label, `aria-disabled`); any other stored state (none, or declined) SHALL render the fresh enabled confirm button. A successful submit SHALL flip the just-pressed button into the confirmed presentation without a page reload, move focus to it, announce the outcome through a polite live region ("Your reservation is confirmed."), and re-read the count. When no valid cookie is present, the controls SHALL be entirely absent from the markup — no empty shell, no placeholder, and no identity-lookup request of any kind. (Change-of-mind resubmission is intentionally one-directional: a declined or unresponded invitee can confirm; a confirmed invitee sees no UI path back — the API remains the support path.)

When the cookie resolves to a **group invite** (valid but unclaimed identity), the confirm-reservation form SHALL be rendered `hidden` in the HTML rather than omitted, preserving one-shot submit listener binding. Slot claiming is performed at the entry claim gate, so the section SHALL NOT render an inline mid-scroll claim form or trigger a mid-scroll full page reload. When a guest completes the entry claim gate during the pageview, the section SHALL listen for `claim:success` on `window` and unhide the confirm-reservation form without a browser reload, matching the member identity established at entry. When the group quota is open but unclaimed (e.g. after a failsafe exit), the section renders no active confirm control and displays read-only entry guidance. When the group quota is exhausted (`claimedCount >= maxMembers`), the section SHALL render the read-only "group is at capacity" state. The section SHALL NOT issue RSVP writes for unclaimed group identities.

#### Scenario: Unresponded invitee sees fresh confirm button

- **WHEN** an invite holder (standalone individual or member) with no stored response is served the homepage
- **THEN** the controls render in the HTML with their display name and an enabled confirm-reservation button — no choice toggle, no stepper

#### Scenario: Freshly claimed member from entry gate sees confirm button

- **WHEN** a visitor claims a member slot at the entry claim gate and scrolls to the RSVP section
- **THEN** the section unhides and activates the confirm-reservation form under their member identity without a page reload

#### Scenario: Declined invitee can confirm

- **WHEN** an invite holder whose stored response is declined is served the homepage
- **THEN** they see the enabled confirm button, and submitting it overwrites the stored response to attending (upsert)

#### Scenario: Confirmed invitee sees the confirmed state

- **WHEN** an invite holder whose stored response is `attending: true` is served the homepage
- **THEN** the button renders server-side disabled in its confirmed presentation (confirmed label, `aria-disabled="true"`) with the rim light still rotating

#### Scenario: Group-cookie visitor sees capacity state or entry guidance, not an inline claim form

- **WHEN** a visitor whose cookie maps to an unclaimed group invite is served the homepage
- **THEN** the HTML contains no active confirm-reservation button and no mid-scroll claim form input, displaying read-only status instead

#### Scenario: Group-cookie visitor at capacity sees a read-only state

- **WHEN** a visitor whose cookie maps to a group invite with `claimedCount = maxMembers` is served the homepage
- **THEN** the HTML shows the capacity state — no claim form, no confirm button — and the page issues no RSVP write

#### Scenario: Anonymous visitor markup has no controls

- **WHEN** a visitor without a valid cookie is served the homepage
- **THEN** the HTML contains no RSVP controls, no claim form, and no display name, and the page issues no request to `GET /api/rsvp`

#### Scenario: Successful submit flips to confirmed and updates counter

- **WHEN** an invite holder presses the confirm button and the write succeeds
- **THEN** the button flips to the confirmed presentation (label swap, disabled) without a reload, focus moves to it, a polite live region announces the confirmation, and the counter re-reads the count (rolling to the new total when it differs)

#### Scenario: Failed submit keeps the button available

- **WHEN** a submit fails (400 or 503 or network error)
- **THEN** the button remains enabled and pressable and a brief inline error note appears — the section layout does not shift, and no error copy refers to a headcount control

#### Scenario: Claim-required response routes back to the claim state

- **WHEN** any RSVP submit unexpectedly receives `409 claim_required`
- **THEN** the section reloads to re-resolve identity rather than showing a generic failure
