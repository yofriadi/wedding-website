# story-rail-mocks Spec Delta

## MODIFIED Requirements

### Requirement: Mock story tiles render while the wall is empty

The story rail SHALL render three mock story tiles in the server HTML for all visitors, positioned after the demo tiles, while zero real guest stories exist (no submission has any photo). The gate SHALL be uniform and cookie-blind: once at least one real guest story exists, the server SHALL NOT render mock tiles for any visitor — public or invitee. Mocks are a "coming soon" placeholder that yields to real content; the first real story removes them everywhere. With the public wall (public-wall change), the public rail then renders the real wall tiles anonymously, alongside the invitee rail.

Each mock SHALL be a named, avatar-bearing, clickable `StoryViewer` component (2–3 stories, with a timestamp) built from couple-curated public image assets, and each mock's `<story-viewer>` element SHALL carry a `data-mock` attribute. The gating check SHALL be a server-side read for the existence of any guest photo; on database error it SHALL fail open (render mocks).

#### Scenario: Public visitor sees mocks on an empty wall

- **WHEN** a public visitor views the rail while no real guest story exists
- **THEN** three mock story tiles render after the demo tiles (the page still makes its one submissions request per load — public-wall D2 retires the zero-request guarantee — but the empty wall evicts nothing)

#### Scenario: Public rail drops mocks after the first real post

- **WHEN** a public visitor views the rail after the first real story exists
- **THEN** no mock tiles render, and the public rail renders the real wall tiles (served anonymously per the public-wall change)

#### Scenario: Invitee sees mocks on an empty wall

- **WHEN** an invitee views the rail while no real guest story exists
- **THEN** three mock story tiles render after the demo tiles

#### Scenario: Non-empty wall omits mocks for any visitor

- **WHEN** any visitor (public or invitee) views the rail and at least one submission has photos
- **THEN** the server HTML contains no mock tiles

#### Scenario: Database check failure fails open

- **WHEN** the mock-gating database read fails
- **THEN** mocks render as if the wall were empty

### Requirement: Mock tiles evict live on the first real story

The client SHALL remove all mock tiles without a page reload once the fresh submissions payload contains any real story — the caller's own or the wall's — both at initial load and on the `submissions:posted` re-sync. A wish-only submission SHALL NOT evict mocks (it creates no story tile). Mock removal SHALL leave no side effects: no body-portaled modal element, no scroll lock, no live timers. (With the public wall, all visitors run this client eviction path — anonymous and invitee alike — since all visitors now fetch the payload.)

#### Scenario: Anonymous visitor's rail evicts mocks on load

- **WHEN** an anonymous visitor's page shows SSR mocks (empty-wall gate) and the fetched payload contains any real story
- **THEN** the client removes every mock tile with no side effects, and the wall tiles render in its place
