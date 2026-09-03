# guest-wishes Spec Delta

## Purpose

Wish submission (text) and its display on the wish marquee: one wish per invite (as part of the single submission), invite-only visibility, no author attribution, deliberate empty-state handling.

## ADDED Requirements

### Requirement: One submission per invite

The system SHALL enforce at most one submission per invite, via a database-level `UNIQUE(invite_id)` constraint, and SHALL reject further attempts with `409`.

#### Scenario: First post succeeds

- **WHEN** an invite holder posts via `POST /api/submissions` with a valid cookie and no prior submission
- **THEN** a submission row is created attributed to that invite and the response is `201`

#### Scenario: Second post is rejected

- **WHEN** the same invite posts again (including concurrent attempts racing the constraint)
- **THEN** the response is `409 { "error": "already_posted" }` and no new row exists

#### Scenario: Anonymous post is rejected invisibly

- **WHEN** `POST /api/submissions` is sent without a valid invite cookie
- **THEN** the response is `404` (same body shape as invite-session not-found; endpoint behaves as nonexistent)

### Requirement: Wish text validation

Wish text, when provided, SHALL be trimmed server-side, SHALL be 1–30 characters after trim, and SHALL be rejected otherwise with `400`.

#### Scenario: Blank wish text rejected

- **WHEN** wish text is provided but empty after trim
- **THEN** the response is `400` and no row is created

#### Scenario: Overlong wish rejected

- **WHEN** trimmed wish text exceeds 30 characters
- **THEN** the response is `400` and no row is created

### Requirement: Submission requires content

A submission SHALL contain at least one of wish text or photos; an empty submission SHALL be rejected with `400`.

#### Scenario: Empty submission rejected

- **WHEN** neither wish text nor photos are provided
- **THEN** the response is `400` and no row is created

### Requirement: Wishes readable by invitees only

The system SHALL expose `GET /api/submissions` returning real wishes only to callers with a valid invite cookie, ordered newest-first, with no author attribution.

- **WHEN** `GET /api/submissions` is sent with a valid invite cookie
- **THEN** the response is `200` with `wall.wishes` an array of `{ text }` ordered newest-first, and `mine` the caller's own submission or null, where `mine` is `{ id: string, wishText: string | null, photos: [{ photoUrl: string }] }` (photo entries ordered by position) or `null`
- **AND** `wall.stories` is an array of submissions, newest-first, each `{ photos: [{ photoUrl: string }] }` (positions are per-submission and not exposed on the wall)

#### Scenario: Anonymous read is rejected invisibly

- **WHEN** `GET /api/submissions` is sent without a valid invite cookie
- **THEN** the response is `404` (endpoint behaves as nonexistent for the public)

### Requirement: No author attribution anywhere

Wishes and stories SHALL render without author names; responses SHALL NOT include any invite display name or author field.

#### Scenario: No names in responses

- **WHEN** any submissions endpoint responds successfully
- **THEN** no author, name, or display_name field appears in the payload

#### Scenario: No names rendered

- **WHEN** real wishes render on the wish marquee for an invitee
- **THEN** no author attribution is displayed with any wish

### Requirement: Wish marquee display states

The wish marquee (renamed from TestimonialMarquee) SHALL implement: demo-only (public), demo + leading "Be the first to leave a wish ✨" card (invitee, zero real wishes), real-only (invitee, ≥1 real wish).

#### Scenario: Public visitor

- **WHEN** a visitor without a cookie views the marquee
- **THEN** demo wishes render in decorative styling and no fetch to submissions endpoints occurs

#### Scenario: Invitee with zero real wishes

- **WHEN** a cookie holder views the marquee before any invitee has posted
- **THEN** demo wishes render with a leading "Be the first to leave a wish ✨" card

#### Scenario: Invitee after the first real wish exists

- **WHEN** a cookie holder views the marquee and at least one real wish exists
- **THEN** only real wishes render (demo content evicted)

#### Scenario: Returning poster sees their posted state

- **WHEN** a cookie holder who already posted loads the page
- **THEN** the add-story entry is not shown and `mine` reflects their submission

### Requirement: Marquee rebuild preserves the loop

When swapping demo content for real wishes, the client SHALL repeat the real list until each row's content width exceeds the track width, duplicate each row's content per the existing two-copy structure, and preserve staggered per-row animation timing.

#### Scenario: One real wish fills the track

- **WHEN** exactly one real wish exists and the marquee swaps to real-only
- **THEN** the wish text repeats across each row's content until the row is wider than the viewport and the scroll loop shows no blank gap
