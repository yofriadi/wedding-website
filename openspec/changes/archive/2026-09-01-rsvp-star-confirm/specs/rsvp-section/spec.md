# rsvp-section Spec Delta

## Purpose

Collapses the invitee RSVP form to a single confirm-reservation button (the `star-button` capability) with a disabled confirmed state, removes the Attending/Decline choice and the party-size stepper, and makes the section presentation theme-aware (dark baseline, light inversion via device preference). The RSVP API contract is unchanged — the UI simply always submits `{ attending: true, partySize: 1 }`.

> Merge-order note: the source requirements live in the complete-but-unarchived `rsvp-live-count` change. This delta assumes `rsvp-live-count` archives first (pattern per `swipe-gate-reveal` → `invite-only-personalization`).

## MODIFIED Requirements

When the request carries a valid `ww_invite_id` cookie, the section SHALL render — in the server HTML — controls comprising the invite's display name and a single confirm-reservation submit button (the `star-button` presentation). The button SHALL always submit `attending: true` with `partySize: 1` to `POST /api/rsvp`; no attending/decline choice and no party-size stepper SHALL be rendered, and the invite's `maxPartySize`/party-size props SHALL no longer reach the component. An invite holder whose stored response is `attending: true` SHALL see the button disabled in its confirmed presentation (confirmed label, `aria-disabled`); any other stored state (none, or declined) SHALL render the fresh enabled confirm button. A successful submit SHALL flip the just-pressed button into the confirmed presentation without a page reload, move focus to it, announce the outcome through a polite live region ("Your reservation is confirmed."), and re-read the count. When no valid cookie is present, the controls SHALL be entirely absent from the markup — no empty shell, no placeholder, and no identity-lookup request of any kind. (Change-of-mind resubmission is intentionally one-directional: a declined or unresponded invitee can confirm; a confirmed invitee sees no UI path back — the API remains the support path.)

#### Scenario: Unresponded invitee sees fresh confirm button

- **WHEN** an invite holder with no stored response is served the homepage
- **THEN** the controls render in the HTML with their display name and an enabled confirm-reservation button — no choice toggle, no stepper

#### Scenario: Declined invitee can confirm

- **WHEN** an invite holder whose stored response is declined is served the homepage
- **THEN** they see the enabled confirm button, and submitting it overwrites the stored response to attending (upsert)

#### Scenario: Confirmed invitee sees the confirmed state

- **WHEN** an invite holder whose stored response is `attending: true` is served the homepage
- **THEN** the button renders server-side disabled in its confirmed presentation (confirmed label, `aria-disabled="true"`) with the rim light still rotating

#### Scenario: Anonymous visitor markup has no controls

- **WHEN** a visitor without a valid cookie is served the homepage
- **THEN** the HTML contains no RSVP controls and no display name, and the page issues no request to `GET /api/rsvp`

#### Scenario: Successful submit flips to confirmed and updates counter

- **WHEN** an invite holder presses the confirm button and the write succeeds
- **THEN** the button flips to the confirmed presentation (label swap, disabled) without a reload, focus moves to it, a polite live region announces the confirmation, and the counter re-reads the count (rolling to the new total when it differs)

#### Scenario: Failed submit keeps the button available

- **WHEN** a submit fails (400 or 503 or network error)
- **THEN** the button remains enabled and pressable and a brief inline error note appears — the section layout does not shift, and no error copy references the removed party-size control

### Requirement: FAQ copy stays truthful

FAQ entries that describe RSVP behavior SHALL match the shipped behavior: the late-RSVP wording SHALL ask (not mandate) a response by the deadline while no cutoff is enforced, and the plus-one wording SHALL describe a simple attendance confirmation consistent with the single confirm button (no party-size confirmation step exists in the UI).

#### Scenario: Deadline wording is a request

- **WHEN** the FAQ RSVP-deadline entry is read
- **THEN** it asks guests to respond by the stated date without claiming late responses are rejected

#### Scenario: Plus-one wording matches the UI

- **WHEN** the FAQ plus-one entry is read
- **THEN** it describes confirming attendance (a single confirmation action), with no promise of a per-person name list and no reference to confirming for one's party via a party-size control

## ADDED Requirements

### Requirement: Theme-aware section presentation

The RSVP section (background, confirmed-guest counter, section copy, and its buttons) SHALL follow the device's color-scheme preference: the dark presentation (neutral-950 background, near-white foreground) SHALL be the baseline, and `prefers-color-scheme: light` SHALL invert the section to white background with near-black foreground, with equivalent contrast. Theming SHALL use CSS custom properties with dark fallbacks overridden in a light media-query block (repo pattern), device preference only — no toggle and no stored preference. Only this section is themed by this change; adjacent sections may remain dark (accepted seam).

#### Scenario: Dark presentation unchanged

- **WHEN** a visitor with dark preference (or no preference) views the section
- **THEN** the section renders the neutral-950 background and near-white text exactly as previously shipped

#### Scenario: Light presentation inverts the section

- **WHEN** a visitor with light preference views the section
- **THEN** the section background is white, the counter digits and copy are near-black, and the confirm button uses its light token set — with contrast equivalent to the dark presentation

#### Scenario: Theme follows device, not a control

- **WHEN** the visitor changes their device color-scheme preference and reloads
- **THEN** the section renders the corresponding presentation; the page offers no theme toggle and stores no theme preference
