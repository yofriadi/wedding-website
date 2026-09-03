# story-rail-mocks Spec Delta

## Purpose

Empty-state placeholders for guest stories: mock story tiles fill the rail so it never looks thin, and (for invitees) make way for real guest tiles the moment real stories exist.

## ADDED Requirements

### Requirement: Mock story tiles render while the wall is empty

The story rail SHALL render three mock story tiles in the server HTML for all visitors, positioned after the demo tiles, while zero real guest stories exist (no submission has any photo). The gate SHALL be uniform and cookie-blind: once at least one real guest story exists, the server SHALL NOT render mock tiles for any visitor — public or invitee. Mocks are a "coming soon" placeholder that yields to real content; the first real story removes them everywhere, including from the public rail (which, per the public-wall change, then renders the real wall tiles anonymously rather than falling back to teaser/demo content).

#### Scenario: Public visitor sees mocks on an empty wall

- **WHEN** a visitor without a cookie views the rail and no real guest story exists
- **THEN** three mock story tiles render after the demo tiles (the public page now makes one submissions-endpoint request per load — see the public-wall change; an empty wall evicts nothing)

#### Scenario: Public rail drops mocks after the first real post

- **WHEN** a visitor without a cookie views the rail and at least one real guest story exists
- **THEN** no mock tiles render, and the public rail renders the real wall tiles (served anonymously per the public-wall change)

#### Scenario: Invitee sees mocks on an empty wall

- **WHEN** a cookie holder views the rail and no real guest story exists
- **THEN** three mock story tiles render after the demo tiles

#### Scenario: Non-empty wall omits mocks for any visitor

- **WHEN** any visitor (public or invitee) views the rail and at least one submission has photos
- **THEN** the server HTML contains no mock tiles

#### Scenario: Database check failure fails open

- **WHEN** the mock-gating database read fails
- **THEN** mocks render as if the wall were empty

### Requirement: Mock tiles evict live on the first real story

For invitees, the client SHALL remove all mock tiles without a page reload once the fresh submissions payload contains any real story — the caller's own or the wall's — both at initial load and on the `submissions:posted` re-sync. A wish-only submission SHALL NOT evict mocks (it creates no story tile). Mock removal SHALL leave no side effects: no body-portaled modal element, no scroll lock, no live timers. (With the public wall — the public-wall change — all visitors run this client eviction path, anonymous and invitee alike, since all visitors fetch the payload; the SSR gate remains the initial decision for everyone.)

#### Scenario: Posting guest's mocks evict without reload

- **WHEN** a guest successfully posts a submission with photos
- **THEN** mock tiles are removed from the rail in the same session and real guest tiles render in the rail

#### Scenario: Wish-only post keeps mocks

- **WHEN** a guest successfully posts a submission with wish text but no photos
- **THEN** mock tiles remain in the rail

#### Scenario: Race between SSR and client fetch

- **WHEN** mocks were server-rendered but another guest posted photos before this client's submissions fetch resolves
- **THEN** the client removes the mock tiles at initial load

#### Scenario: Eviction while a mock's story is open

- **WHEN** mock eviction runs while a mock tile's story modal is open
- **THEN** the modal is removed, body scroll is restored, and no progress timers keep running on detached elements

### Requirement: Mocks are honest interactive previews

Mock tiles SHALL behave as real story tiles: tap/click opens the story modal with working progress, gesture, and keyboard navigation, and rail hand-off (`story-viewer-end` / `story-viewer-prev`) traverses them in rail order. Mocks SHALL use only existing public image assets (no new asset pipeline) and SHALL NOT trigger any submissions-endpoint request of their own (the page's one shared per-load fetch — public-wall change — is not a per-mock request).

#### Scenario: Mock opens the story modal

- **WHEN** a visitor activates a mock tile
- **THEN** the story modal opens and plays the mock's stories like any other tile

#### Scenario: Hand-off traverses mocks

- **WHEN** a story modal reaches its last slide while viewing the demo tile immediately before the mocks
- **THEN** viewing hands off to the first mock tile in rail order
