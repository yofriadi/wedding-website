# guest-photos Spec Delta

## MODIFIED Requirements

### Requirement: Photos served to invitees only via the wall

Renamed: **Photos served via the wall**

Photo URLs SHALL be returned by `GET /api/submissions` to all callers — anonymous visitors receive `{ mine: null, wall: { wishes, stories } }` with the same wall content cookie holders see (minus `mine`). Photos render in the story rail as story tiles without author attribution. Files are served through the app (or a cacheable app route) with proper content-type — never via a public static directory that bypasses validation.

#### Scenario: Invitee sees guest photos in the rail

- **WHEN** a cookie holder views the story rail and photos exist
- **THEN** guest photo tiles render among/after demo tiles with no name attribution

#### Scenario: Anonymous visitor sees guest photos in the rail

- **WHEN** a visitor without a cookie views the story rail and photos exist
- **THEN** `GET /api/submissions` responds 200 with `mine: null` and the wall, and guest photo tiles render in the rail with no name attribution

#### Scenario: Anonymous direct file access succeeds

- **WHEN** a valid photo path is requested without a cookie
- **THEN** the photo file is served (photos are public by decision; keys are unguessable submission-scoped paths)

#### Scenario: Anonymous rail when the wall is empty

- **WHEN** a visitor without a cookie views the story rail and no photos exist
- **THEN** the rail shows the demo/teaser/mock content per the story-teaser and story-rail-mocks capabilities (the API returns an empty wall)

### Requirement: Submissions API never cached; photo files cacheable

`GET /api/submissions` SHALL send `Cache-Control: no-store` on every response. The photo route `GET /api/photos/<key>` SHALL send cacheable headers suitable for immutable content (keys are write-once) and MAY be shared-cached.

#### Scenario: Submissions API never cached

- **WHEN** `GET /api/submissions` responds
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Photo route is publicly cacheable

- **WHEN** `GET /api/photos/<key>` responds successfully
- **THEN** the response carries `Cache-Control: public, max-age=31536000, immutable` (keys are write-once and unguessable; a shared cache may serve them)

#### Scenario: Missing-file responses are never cached

- **WHEN** `GET /api/photos/<key>` responds 404 (missing or malformed key)
- **THEN** the response carries `Cache-Control: no-store`
