# database-baseline Specification (delta)

## MODIFIED Requirements

### Requirement: Fresh setup creates only the current application tables

The committed initial migration SHALL create `invites`, `rsvps`, and `guest_photos` directly in their final form. It SHALL NOT create `submissions`, `submission_photos`, wish fields, party-size fields, or ordered-photo grouping. Drizzle's own migration tracking table is separate from these three application tables.

`invites` SHALL retain `id`, `display_name`, `created_at`, `seen_at`, `seen_count`, `opened_at`, and `opened_count`, including nullable tracking timestamps and zero-default non-null counters, and SHALL additionally carry `parent_id` (nullable, self-referencing FK to `invites.id`), `type` (text, NOT NULL, default `'individual'`), and `max_members` (nullable integer), with an index on `parent_id` and CHECK constraints enforcing the group/member row shapes defined by the `group-invitations` capability (type domain, `type='group'` ⟺ `max_members IS NOT NULL`, `parent_id ⇒ type='individual'`, `max_members` range 2–50). `rsvps` SHALL retain `invite_id` as primary key and FK, `attending`, `responded_at`, `updated_at`, and the attending index. The `guest_photos` table SHALL satisfy the guest-photos capability's persistence constraints.

#### Scenario: Empty database initialized

- **WHEN** the committed migration is applied to a new SQLite database
- **THEN** the three application tables, their declared indexes, foreign keys (including the `invites.parent_id` self-FK), and CHECK constraints, and Drizzle migration tracking exist
- **AND** neither legacy submission table nor `wish_text`, `max_party_size`, or `party_size` exists

#### Scenario: Invite and RSVP behavior preserved

- **WHEN** an invite is created and its RSVP is submitted and subsequently changed against the fresh baseline
- **THEN** invite tracking defaults remain correct (including `type = 'individual'` and `parent_id IS NULL` by default), one RSVP row is updated in place, its first-response timestamp is preserved, and the public count remains the count of attending invitations

#### Scenario: Group row shapes enforced at the database

- **WHEN** a row is inserted violating the group/member shape rules (group without `max_members`, out-of-range `max_members`, group with `parent_id`, individual with `max_members`)
- **THEN** the database rejects it with a CHECK constraint error
