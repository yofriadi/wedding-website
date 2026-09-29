# rsvp-section Specification (delta)

## MODIFIED Requirements

### Requirement: Server-rendered invitee controls

When the request carries a valid `ww_invite_id` cookie resolving to a standalone individual or member invite, the section SHALL render — in the server HTML — a single confirm-reservation submit button. The button SHALL submit `attending: true` to `POST /api/rsvp`; no attending/decline choice or headcount control SHALL be rendered. An invite holder whose stored response is `attending: true` SHALL see the button disabled in its confirmed presentation (confirmed label, `aria-disabled`); any other stored state (none, or declined) SHALL render the fresh enabled confirm button. A successful submit SHALL flip the just-pressed button into the confirmed presentation without a page reload, move focus to it, announce the outcome through a polite live region ("Your reservation is confirmed."), and re-read the count. When no valid cookie is present, the controls SHALL be entirely absent from the markup — no empty shell, no placeholder, and no identity-lookup request of any kind. (Change-of-mind resubmission is intentionally one-directional: a declined or unresponded invitee can confirm; a confirmed invitee sees no UI path back — the API remains the support path.)

When the cookie resolves to a **group invite** (valid but unclaimed identity), the confirm-reservation button SHALL NOT render; the server HTML SHALL instead render the group's display name with a name-prompt claim form while `claimedCount < maxMembers`, or a read-only "group is at capacity" state when the quota is exhausted. A successful claim SHALL trigger a full page reload so the section re-renders server-side under the new member identity (the confirm button then appears per the rules above). The claim form and the capacity state SHALL NOT issue RSVP writes. When the cookie resolves to a **member invite** whose parent group still has an open slot, the section SHALL additionally render a "Not you? Claim your own spot" **control** targeting the group link with `?fresh=1`. When the parent group is at capacity the control SHALL NOT render: the release is one-way for that browser and a re-claim would need a slot that does not exist, so offering it could only strand the member — and it would help nobody, because the second household member it exists to unblock cannot claim either. The control SHALL require a two-step confirmation before activation, and the two activations SHALL be separated by a short minimum interval so that one nervous double-tap cannot both arm and activate. It SHALL NOT be an anchor with a navigable `href`: a static URL is reachable by middle-click, the context menu, iOS long-press, drag-to-bookmarks, copy-link-address, and a no-script tap — every one of which bypasses the two-step and reaches the destructive endpoint carrying gate-passing `Sec-Fetch` metadata. The target URL SHALL instead live in a data attribute, and navigation SHALL be performed by the page's own script on the confirmed activation. The armed state SHALL be announced to assistive technology, and a confirmation that lapses unused SHALL announce that it was cancelled rather than reverting silently. The claim form SHALL declare `method="post"` and its `action`, so a no-script submit cannot carry the guest's private display name in the URL.

#### Scenario: Unresponded invitee sees fresh confirm button

- **WHEN** an invite holder (standalone individual or member) with no stored response is served the homepage
- **THEN** the controls render in the HTML with their display name and an enabled confirm-reservation button — no choice toggle, no stepper

#### Scenario: Declined invitee can confirm

- **WHEN** an invite holder whose stored response is declined is served the homepage
- **THEN** they see the enabled confirm button, and submitting it overwrites the stored response to attending (upsert)

#### Scenario: Confirmed invitee sees the confirmed state

- **WHEN** an invite holder whose stored response is `attending: true` is served the homepage
- **THEN** the button renders server-side disabled in its confirmed presentation (confirmed label, `aria-disabled="true"`) with the rim light still rotating

#### Scenario: Group-cookie visitor sees the claim form, not the confirm button

- **WHEN** a visitor whose cookie maps to a group invite with open slots is served the homepage
- **THEN** the HTML contains the group's display name and the name-prompt claim form, and no confirm-reservation button is rendered

#### Scenario: Group-cookie visitor at capacity sees a read-only state

- **WHEN** a visitor whose cookie maps to a group invite with `claimedCount = maxMembers` is served the homepage
- **THEN** the HTML shows the capacity state — no claim form, no confirm button — and the page issues no RSVP write

#### Scenario: Claim success re-renders under the member identity

- **WHEN** a visitor submits the claim form and the claim succeeds
- **THEN** the page reloads so all server-rendered surfaces (RSVP controls, greeting) reflect the new member identity in one consistent render

#### Scenario: Anonymous visitor markup has no controls

- **WHEN** a visitor without a valid cookie is served the homepage
- **THEN** the HTML contains no RSVP controls, no claim form, and no display name, and the page issues no request to `GET /api/rsvp`

#### Scenario: Member sees the release control only while a slot remains

- **WHEN** a member of a group with `claimedCount < maxMembers` is served the homepage
- **THEN** the section renders their confirm control plus the "Not you? Claim your own spot" control, and the control's first activation arms rather than navigating

#### Scenario: No release control when the parent group is full

- **WHEN** a member of a group with `claimedCount = maxMembers` is served the homepage
- **THEN** the section renders their confirm control and no release control

#### Scenario: One nervous double-tap cannot release

- **WHEN** the release control is activated twice inside the minimum armed interval
- **THEN** the second activation is refused and the control stays armed

#### Scenario: Successful submit flips to confirmed and updates counter

- **WHEN** an invite holder presses the confirm button and the write succeeds
- **THEN** the button flips to the confirmed presentation (label swap, disabled) without a reload, focus moves to it, a polite live region announces the confirmation, and the counter re-reads the count (rolling to the new total when it differs)

#### Scenario: Failed submit keeps the button available

- **WHEN** a submit fails (400 or 503 or network error)
- **THEN** the button remains enabled and pressable and a brief inline error note appears — the section layout does not shift, and no error copy refers to a headcount control

#### Scenario: Claim-required response routes back to the claim state

- **WHEN** any RSVP submit unexpectedly receives `409 claim_required` (e.g. a stale render after a release)
- **THEN** the section reloads to re-resolve identity rather than showing a generic failure
