## ADDED Requirements

### Requirement: Fresh setup creates only the current application tables

The committed initial migration SHALL create `invites`, `rsvps`, and `guest_photos` directly in their final form. It SHALL NOT create `submissions`, `submission_photos`, wish fields, party-size fields, or ordered-photo grouping. Drizzle's own migration tracking table is separate from these three application tables.

`invites` SHALL retain `id`, `display_name`, `created_at`, `seen_at`, `seen_count`, `opened_at`, and `opened_count`, including nullable tracking timestamps and zero-default non-null counters. `rsvps` SHALL retain `invite_id` as primary key and FK, `attending`, `responded_at`, `updated_at`, and the attending index. The `guest_photos` table SHALL satisfy the guest-photos capability's persistence constraints.

#### Scenario: Empty database initialized

- **WHEN** the committed migration is applied to a new SQLite database
- **THEN** the three application tables, their declared indexes and foreign keys, and Drizzle migration tracking exist
- **AND** neither legacy submission table nor `wish_text`, `max_party_size`, or `party_size` exists

#### Scenario: Invite and RSVP behavior preserved

- **WHEN** an invite is created and its RSVP is submitted and subsequently changed against the fresh baseline
- **THEN** invite tracking defaults remain correct, one RSVP row is updated in place, its first-response timestamp is preserved, and the public count remains the count of attending invitations

### Requirement: Migration SQL and Drizzle metadata form one baseline

The migration directory SHALL contain one generated initial SQL migration, its matching initial snapshot, and a journal with exactly one matching entry. The existing `0000`–`0005` SQL and snapshots SHALL be replaced together rather than edited independently or followed by a data-conversion migration. Future schema generation SHALL use this baseline as its predecessor.

#### Scenario: Initial artifacts agree

- **WHEN** the initial migration, snapshot, and journal are inspected
- **THEN** their table/column/index definitions match the exported schema and the journal identifies only that initial migration

#### Scenario: Unchanged schema generates no follow-up

- **WHEN** the migration generator runs against the committed baseline without any schema changes
- **THEN** it reports no schema change and creates no additional SQL migration or journal entry

### Requirement: Actual migration execution is repeatable and verified

Fresh-setup verification SHALL use the configured Drizzle migrator against an explicitly selected disposable database, not solely execute SQL files directly. It SHALL inspect the resulting schema and migration tracking, verify integrity and foreign-key checks, and verify constraint enforcement with foreign keys enabled as in the application.

#### Scenario: Second migration run is a no-op

- **WHEN** the actual migrator runs twice on the same freshly initialized database
- **THEN** both runs succeed, the second run does not recreate tables or erase rows, and only one initial migration is recorded

#### Scenario: Invalid guest ownership rejected

- **WHEN** a guest photo is inserted with a nonexistent invite using the application's foreign-key configuration
- **THEN** the database rejects the row and subsequent integrity and foreign-key checks report no violation

#### Scenario: Tests have no historical migration dependency

- **WHEN** database-backed RSVP, photo, and homepage tests initialize their fixtures
- **THEN** they use the new baseline and current fields rather than requiring a historical migration filename, old submission DDL, or party-size columns

### Requirement: Baseline replacement is not an automatic database reset

The new history SHALL be documented and tested as a fresh-install baseline only. Application startup, migration commands, tests, and proposal generation SHALL NOT automatically delete, clear, or rewrite an existing non-test database or upload directory. Replacing an already initialized environment MUST require an explicitly identified target, confirmation that it is disposable, and authorization for the reset. Local resets MUST stop database writers and background image work before handling the database and SQLite sidecars. Guest-upload storage SHALL be handled separately from family assets under `public/`.

#### Scenario: Implementation verification leaves developer state intact

- **WHEN** the change is implemented and verified with a disposable temporary database and storage directory
- **THEN** the developer's existing database, WAL/SHM files, configured upload directory, and public family assets remain untouched

#### Scenario: Existing migration history is encountered

- **WHEN** an operator prepares to use the new baseline on an already initialized environment
- **THEN** setup instructions require a separately confirmed replacement or new empty target and do not describe the baseline as an in-place upgrade

#### Scenario: Data must be preserved after all

- **WHEN** real user data is discovered before deployment
- **THEN** the reset is stopped and a data-preserving migration plan is required instead of using the clean-baseline procedure

### Requirement: Restore verification checks the new schema and fails on query errors

The restore drill SHALL verify `invites`, `rsvps`, and `guest_photos`, retain database integrity checks, and fail with a nonzero exit when a required table cannot be queried in either database. A pair of SQL failures SHALL NOT count as equal row counts. Restore/moderation documentation SHALL refer to the new schema and photo paths; backups SHALL continue excluding partial image files.

#### Scenario: Valid quiescent backup passes

- **WHEN** the drill compares a valid backup and a matching quiescent live fixture with the new schema and photo tree
- **THEN** integrity and the three table-count checks pass without querying legacy submission tables

#### Scenario: Matching missing tables do not pass

- **WHEN** `guest_photos` is absent from both the restored and live database
- **THEN** the drill exits nonzero rather than treating two failed queries as matching `n/a` counts

#### Scenario: One database query fails

- **WHEN** a required count query fails on either side of the restore comparison
- **THEN** the drill reports failure even if the other side returns a count

#### Scenario: Manual moderation follows the one-photo model

- **WHEN** an operator follows the updated moderation procedure
- **THEN** it identifies one guest photo, removes its row and owned photo directory with writers stopped, explains that the invite can post again, and does not prescribe legacy child-table deletion or an unsafe invite deletion as a ban
