# guest-photos Spec Delta

## Purpose

Corrects rail rendering of guest tiles (container targeting, post-submit completeness, own-tile persistence) and updates the anonymous-rail scenario to account for mock tiles.

(Base spec lands with the `guest-submissions` archive — see proposal D-ordering note.)

## ADDED Requirements

### Requirement: Guest tiles render inside the rail container

Dynamically rendered guest tiles (initial wall render and post-submit) SHALL be appended inside the rail's horizontal-scroll container — located via the container's explicit `data-story-rail` hook — never as children of the surrounding section. After a successful post, the rail's guest tile set SHALL reflect the fresh payload: all wall tiles plus the caller's own tile, not the caller's alone.

#### Scenario: Upload appears in the rail

- **WHEN** a guest posts photos and the rail re-renders
- **THEN** the new tile appears within the rail's scrollable row, after the demo/teaser tiles

#### Scenario: Post-submit keeps other guests' tiles

- **WHEN** a guest posts while other guests' tiles are in the rail
- **THEN** those tiles remain rendered after the re-sync

### Requirement: Invitee's own tile renders on initial load

For a cookie holder whose prior submission includes photos, the rail's initial client render SHALL include the caller's own tile (from `mine`) in addition to the wall — the tile SHALL NOT require a new post or appear only until reload.

#### Scenario: Posted invitee reloads

- **WHEN** a guest who has posted photos reloads the page
- **THEN** their own story tile renders in the rail on initial load

#### Scenario: Sole real story is the caller's own

- **WHEN** the only submission with photos belongs to the viewing invitee
- **THEN** the rail renders their tile (and, per story-rail-mocks, no mock tiles)

## MODIFIED Requirements

### Requirement: Photos served to invitees only via the wall

Photo URLs SHALL be returned by `GET /api/submissions` to all callers (per the public-wall change: anonymous callers receive `{ mine: null, wall }` with the same wall); photos render in the story rail as story tiles without author attribution. Files are served through the app (or a cacheable app route) with proper content-type — never via a public static directory. (public-wall supersedes this change's cookie-gated wording below.)

#### Scenario: Invitee sees guest photos in the rail

- **WHEN** a cookie holder views the story rail and photos exist
- **THEN** guest photo tiles render among/after demo tiles with no name attribution

#### Scenario: Anonymous rail shows the wall

- **WHEN** a visitor without a cookie views the story rail
- **THEN** the rail shows demo/teaser content plus — while no real guest story exists — the mock tiles defined by story-rail-mocks; once real guest stories exist, real guest photo tiles render anonymously (public-wall change)

#### Scenario: Guessed photo path still fails

- **WHEN** a guessed photo path is requested (with or without a valid cookie)
- **THEN** the response is 404 — keys are unguessable submission-scoped paths, so valid keys are served publicly and guesses are indistinguishable from missing files (public-wall change)
