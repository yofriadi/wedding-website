# rsvp-section Specification

## Purpose

The RSVP section UI on the homepage: corrected venue copy ("Graha 58 Gedung Serbaguna UMS / Surakarta, Central Java"), a live confirmed-guest counter with the beui.dev NumberTicker rolling-digit effect implemented as a progressive-enhancement custom element (truthful server-rendered count, `motion`'s `animate()` for the rolls), server-rendered attending/decline controls for invite holders, and a guidance line for anonymous visitors. All ticker motion degrades to static text under `prefers-reduced-motion`; the section can never break the homepage when the count query fails.

## ADDED Requirements

### Requirement: Correct venue copy from a shared source

The Event Details / RSVP section SHALL render the venue name "Graha 58 Gedung Serbaguna UMS" and the location line "Surakarta, Central Java" in place of the placeholder "The Grand Estate / San Francisco, California". Both strings SHALL come from a shared exported constant so the venue-map work landing later reuses the same source. The "Formal Invitation to Follow" footer copy SHALL be preserved unchanged.

#### Scenario: Venue name visible

- **WHEN** any visitor loads the homepage
- **THEN** the RSVP section shows "Graha 58 Gedung Serbaguna UMS" and "Surakarta, Central Java" and the strings "The Grand Estate" and "San Francisco" appear nowhere in the rendered homepage

#### Scenario: Exactly one venue-name block

- **WHEN** the venue-map change lands after this one
- **THEN** exactly one venue-name block exists on the page, owned by this section, and both sections render the identical string from the shared constant

### Requirement: Truthful server-rendered count

The section SHALL server-render the current confirmed-guest count as plain text digits, so the number is correct at first paint, before any script runs, and with JavaScript disabled. The client-side counter SHALL NOT fetch the count on initial connect (the server-rendered value is fresh). When the count query fails server-side, the section SHALL degrade — rendering 0 and skipping live updates — without failing the homepage response.

#### Scenario: Count correct at first paint

- **WHEN** the homepage HTML is served with confirmed responses in the database
- **THEN** the RSVP section markup contains the true count as plain readable digits

#### Scenario: JavaScript disabled shows the real number

- **WHEN** a visitor has JavaScript disabled
- **THEN** the server-rendered count remains visible as plain text — never a wrong value such as 0-when-nonzero, never a blank

#### Scenario: Count query failure does not break the page

- **WHEN** the server-side count query throws
- **THEN** the homepage still responds 200, the section renders the counter at 0, and no live-update polling is initialized

### Requirement: Rolling-digit live updates

When JavaScript is available, the counter SHALL enhance into rolling digit columns in the beui.dev NumberTicker style (1.1em clipped 0–9 columns, `tabular-nums`, per-digit staggered entrance roll on first scroll into view, immediate rolls on later value changes, columns keyed by place value so a growing count adds a leftmost column without remounting existing places). While the tab is visible, the count SHALL be re-fetched on a poll interval; polling SHALL pause while the tab is hidden. When a poll returns a changed value, the digits roll to it.

#### Scenario: Entrance roll on first view

- **WHEN** a visitor scrolls the RSVP section into the viewport for the first time
- **THEN** each digit column rolls from 0 to its target digit with the per-digit stagger, playing exactly once

#### Scenario: Live update rolls digits

- **WHEN** a poll returns a count different from the displayed value after the entrance has played
- **THEN** the affected digit columns roll to the new digits immediately, without replaying the entrance stagger

#### Scenario: Hidden tab pauses polling

- **WHEN** the page's visibility state becomes hidden
- **THEN** no count requests are issued until the tab becomes visible again

#### Scenario: Poll failure keeps last value

- **WHEN** a poll request fails (network error or non-200)
- **THEN** the counter keeps displaying its last known value and no error UI replaces the number

#### Scenario: Zero responses renders zero

- **WHEN** no guests have confirmed yet
- **THEN** the counter displays 0 and the section remains fully laid out — no collapsed or hidden state

### Requirement: Reduced motion renders static digits

When the user prefers reduced motion, the counter SHALL remain plain text digits with no rolling, blur, or stagger, and live updates SHALL swap the value instantly.

#### Scenario: Reduced-motion user sees instant swaps

- **WHEN** a visitor with `prefers-reduced-motion: reduce` views the section and the count changes
- **THEN** the displayed number updates immediately with no animation

### Requirement: Server-rendered invitee controls

When the request carries a valid `ww_invite_id` cookie, the section SHALL render — in the server HTML — controls comprising: the invite's display name, an "Attending" / "Decline" choice, a party-size stepper bounded 1…`max_party_size` (visible only while attending is chosen), and a submit affordance. A stored response SHALL pre-select the current state, and re-submission (change of mind) SHALL be offered. When no valid cookie is present, the controls SHALL be entirely absent from the markup — no empty shell, no placeholder, and no identity-lookup request of any kind.

#### Scenario: Unresponded invitee sees fresh controls

- **WHEN** an invite holder with no stored response is served the homepage
- **THEN** the controls render in the HTML with their display name, no pre-selected choice, and the stepper capped at their `max_party_size`

#### Scenario: Responded invitee sees current state

- **WHEN** an invite holder with a stored response is served the homepage
- **THEN** their stored attending/declined choice and party size are pre-selected and submittable again (change of mind)

#### Scenario: Anonymous visitor markup has no controls

- **WHEN** a visitor without a valid cookie is served the homepage
- **THEN** the HTML contains no RSVP controls and no display name, and the page issues no request to `GET /api/rsvp`

#### Scenario: Successful submit updates counter

- **WHEN** an invite holder submits an attending response and the write succeeds
- **THEN** the controls reflect the stored state and the counter re-reads the count (rolling to the new total when it differs)

#### Scenario: Failed submit keeps controls editable

- **WHEN** a submit fails (400 or 503 or network error)
- **THEN** the controls remain in their pre-submit editable state and a brief inline error note appears — the section layout does not shift

### Requirement: Anonymous visitors get a guidance line

In place of the removed "RSVP Coming Soon" button, anonymous visitors SHALL see copy directing them to respond through their personal invitation link.

#### Scenario: Anonymous sees the guidance line

- **WHEN** a visitor without a valid cookie views the section
- **THEN** copy in the spirit of "RSVP through your personal invitation link" is shown instead of any interactive control

### Requirement: Counter label and accessibility

The counter SHALL be associated with an explicit label so assistive technology announces the meaning, not a bare integer — e.g. a visually rendered "guests confirmed" label grouped with the number via an `aria-label` or equivalent. Rolling digit columns SHALL be `aria-hidden` and the readable value SHALL be exposed as a single text node (the component's `sr-only` pattern or the plain-text fallback).

#### Scenario: Screen reader hears the total with meaning

- **WHEN** a screen-reader user reaches the RSVP section
- **THEN** the counter is announced as a single phrase conveying the total (e.g. "37 guests confirmed"), never as bare digits or per-digit columns

### Requirement: FAQ copy stays truthful

FAQ entries that describe RSVP behavior SHALL match the shipped behavior: the late-RSVP wording SHALL ask (not mandate) a response by the deadline while no cutoff is enforced, and the party-visibility wording SHALL describe confirming for one's party rather than seeing a per-person name list.

#### Scenario: Deadline wording is a request

- **WHEN** the FAQ RSVP-deadline entry is read
- **THEN** it asks guests to respond by the stated date without claiming late responses are rejected

#### Scenario: Party wording matches the UI

- **WHEN** the FAQ plus-one entry is read
- **THEN** it describes confirming attendance for the guest's own party (consistent with the display-name + stepper controls), with no promise of a per-person name list
