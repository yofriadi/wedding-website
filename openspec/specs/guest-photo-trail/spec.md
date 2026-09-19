# guest-photo-trail Specification

## Purpose

Present all guest photos through the existing magnetic image trail, exactly as collected, with an accessible single-photo upload control.

## Requirements

### Requirement: The trail consumes a flat complete guest-photo collection

The memories section SHALL render through the existing `MagneticImageTrail` using the flat `GET /api/guest-photos` collection. Each persisted photo SHALL be represented once in the source pool, including the viewing invitee's photo. The client SHALL NOT group photos into stories, require names/thumbnails, or mutate the shared cached payload. The existing 18 visible positions SHALL NOT limit the total guest-photo pool; the existing sequence SHALL continue rotating through every available guest source.

#### Scenario: More photos than visible positions

- **WHEN** the collection contains more than 18 distinct guest photos
- **THEN** the full collection is available to the trail sequence and older photos are not discarded by a display-slot limit

#### Scenario: Caller reloads after posting

- **WHEN** a posted invitee reloads the page
- **THEN** their photo appears once in the source pool with all other guests' photos and does not depend on another POST

#### Scenario: Own photo is prioritized

- **WHEN** a resolved payload contains a non-null `mineId`
- **THEN** the matching photo URL is passed to the existing trail priority behavior without duplicating it in the collection

#### Scenario: Shared data is not reordered in place

- **WHEN** the trail selects or shuffles source URLs
- **THEN** the cached payload and its photos array remain unchanged for other consumers

### Requirement: The trail renders exactly the guest collection

The trail SHALL render exactly the distinct guest-photo sources it is given: each photo appears once, a collection smaller than the 18 visible positions leaves the remaining positions empty, and an empty collection renders no images. The trail SHALL NOT pad the collection with starter images, repeats, or any source absent from the collection. Starter family images are no longer automatic fallbacks and SHALL NOT be persisted, returned by the guest-photo API, counted as uploads, or attributed to guests.

#### Scenario: Empty guest collection

- **WHEN** no guest photos exist
- **THEN** the trail renders no images and the API returns an empty photos array

#### Scenario: Partial guest collection

- **WHEN** fewer than 18 distinct guest photos are available
- **THEN** exactly those guest sources are rendered once each, remaining visible positions stay empty, and no database rows are created for them

#### Scenario: Initial request fails

- **WHEN** the initial collection request fails
- **THEN** the trail remains empty rather than substituting non-guest images

#### Scenario: Later request fails

- **WHEN** a later collection request fails after guest photos have been rendered
- **THEN** the currently usable image pool remains visible instead of being replaced by a successful-looking empty collection

### Requirement: Posting eligibility comes only from resolved server state

The upload chooser SHALL become available only after a successful collection response has `inviteValid: true` and `mineId: null`. Cookie shape or presence SHALL NOT authorize the control. Public visitors, stale-cookie holders, unresolved/error states, and existing posters SHALL NOT open a new chooser. An existing poster's retained status or gallery-recovery control SHALL be non-posting. The server's unique invite constraint remains authoritative regardless of client state.

#### Scenario: Eligible invitee can choose a photo

- **WHEN** the server resolves an invite with no prior photo
- **THEN** the add-image control becomes actionable and can open the picker

#### Scenario: Cookie alone is insufficient

- **WHEN** the page has a well-shaped cookie but the request is pending, fails, or resolves it as stale
- **THEN** the control cannot open a file chooser or submit a photo

#### Scenario: Existing photo prevents a new upload

- **WHEN** a payload contains `mineId` for the caller
- **THEN** no new-upload chooser is available even if the caller reloads or refocuses the page

### Requirement: Uploading uses the direct single-photo picker

Activating the eligible add-image control SHALL directly open the native single-file picker within the user activation. Selection SHALL perform client-side count/type/size pre-validation and submit one multipart `photo` file to `/api/guest-photos` without an intro, story viewer, modal, or separate Share step. Cancellation SHALL make no request. Keyboard activation and focus restoration SHALL remain functional.

#### Scenario: One file selected

- **WHEN** an eligible invitee selects one locally valid file
- **THEN** one POST is sent with the singular `photo` field and the upload indicator enters its busy state

#### Scenario: Picker cancelled

- **WHEN** the invitee cancels the native picker
- **THEN** no POST is made and the control remains usable with focus returned appropriately

#### Scenario: Local validation fails

- **WHEN** selection contains multiple files, an unsupported MIME type, or a file larger than 10 MiB
- **THEN** an inline error is shown and nothing is posted; server content validation remains mandatory for accepted client selections

#### Scenario: Repeated activation while uploading

- **WHEN** pointer or keyboard activation repeats while a request is in progress
- **THEN** no second picker or POST is started and busy/disabled accessibility state remains correct

### Requirement: Committed uploads retry display refresh rather than posting again

The client SHALL treat `201` and `409 already_posted` as evidence that the invite's upload slot is committed, disable further posting, invalidate the shared collection cache, and request fresh state. It SHALL complete the visible success state only when the caller's photo is present in the refreshed payload and accepted by the renderer's image-loading path. A subsequent collection or decode failure SHALL expose a refresh-only retry and SHALL NOT resend the photo. After an uncertain transport failure, the client SHALL refresh server state before deciding whether another POST is needed.

#### Scenario: Successful photo appears immediately

- **WHEN** a POST succeeds and the refreshed caller photo decodes
- **THEN** the trail includes and prioritizes that photo without losing other guest sources, and the control shows its success state without reloading the page

#### Scenario: Race loser shows the actual accepted photo

- **WHEN** a concurrent upload receives `409 already_posted`
- **THEN** the client refreshes and displays the persisted caller photo rather than assuming its losing file was stored

#### Scenario: Refresh fails after acceptance

- **WHEN** the upload was accepted but the collection refresh or image decode fails
- **THEN** the UI explains that uploading succeeded but display needs recovery, and retry sends no new POST

#### Scenario: Upload response was lost after commit

- **WHEN** a network error hides a successful server commit and a subsequent read reports the caller's `mineId`
- **THEN** the client enters committed recovery without uploading again

#### Scenario: Server validation fails

- **WHEN** POST returns a `400` validation error
- **THEN** the relevant inline error appears and a new file selection is possible without marking the invite committed

#### Scenario: Invite no longer resolves

- **WHEN** POST returns the uniform authentication `404`
- **THEN** the chooser is disabled, stale selected input is cleared, and the user is prompted to reopen a valid invitation

### Requirement: Shared refreshes are lifecycle-safe and retryable

Collection consumers SHALL share the loader's in-flight successful request, invalidate it after posting, and allow retries after transient failures. The new shared event SHALL be `guest-photos:posted`. Old responses and callbacks SHALL NOT override newer upload/refresh state or mutate detached controls. Listener cleanup and disposal SHALL prevent duplicate work after remounting.

#### Scenario: Multiple consumers initialize

- **WHEN** multiple live consumers request the collection concurrently
- **THEN** they share one in-flight request instead of issuing independent copies

#### Scenario: Transient read failure recovers

- **WHEN** a collection read fails and the page later refocuses or retries
- **THEN** a new read can succeed instead of returning a permanently cached failure

#### Scenario: Stale refresh finishes late

- **WHEN** an older collection/decode operation finishes after a new upload or refresh has begun
- **THEN** it does not restore obsolete eligibility or replace newer gallery state

#### Scenario: Controls are disposed

- **WHEN** the component is torn down while an asynchronous operation is outstanding
- **THEN** its completion does not mutate detached UI or install duplicate event handlers

### Requirement: Contract replacement preserves the current presentation and accessibility

The change SHALL preserve the current trail renderer, sequencing, 18 visible positions, reduced-motion/static presentation, sticky upload control layout, upload indicator, and inline status/error accessibility. It SHALL NOT reintroduce story navigation, hidden example viewers, modal scroll locks, or first-tap intro flags. No animation redesign is required by this capability.

#### Scenario: Reduced-motion visitor uses the new collection

- **WHEN** reduced motion is requested and guest photos load or an upload completes
- **THEN** the trail and upload feedback retain their reduced-motion behavior while using the new data contract

#### Scenario: Legacy story runtime is absent

- **WHEN** the memories section is rendered and a guest interacts with uploading
- **THEN** no story viewer/rail/intro/modal runtime is mounted or required
