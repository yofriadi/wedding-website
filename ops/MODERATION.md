# Moderation runbook (guest-submissions 5.3)

Post-once is the whole moderation story: a bad actor gets one submission per
invite, and a manual removal path is near-free insurance when the couple wants
one gone anyway.

Attribution is partial by design (story-rail-attribution). A STORY tile shows
the poster's first name to every visitor — derived at read time from that
invite's `display_name` (first whitespace token), never snapshotted, so
renaming an invite renames its tiles and the wall needs no cleanup.
Submissions are photo-only (retire-wishes-story-intro): there is no wish text
to moderate.

## Remove a whole submission (photos)

Find the submission id first (stories render newest-first on the wall):

```sh
sqlite3 /srv/wedding/local.db \
  "SELECT s.id, s.created_at, COUNT(p.id) AS photos
     FROM submissions s LEFT JOIN submission_photos p ON p.submission_id = s.id
    GROUP BY s.id ORDER BY s.created_at DESC;"
```

```sh
# 1. delete the row (FK: submission_photos rows go with it via ON DELETE…
#    no action — delete children first:)
sqlite3 /srv/wedding/local.db \
  "DELETE FROM submission_photos WHERE submission_id = '<submission-id>'; DELETE FROM submissions WHERE id = '<submission-id>';"

# 2. remove the files:
rm -rf /srv/wedding/photos/submissions/<submission-id>
```

The guest's invite keeps its `UNIQUE(invite_id)` slot freed — they can post
again. (If you'd rather they NOT be able to repost, remove the invite from
`invites` too.)

## Notes

- Backups still contain the removed content until the 30-day tree rotation
  prunes it. If that matters, re-run `ops/backup.sh` after moderation and
  manually delete older backup trees.
- No restart is needed; the app reads live from SQLite.
- The couple owns root on the VM; this runbook assumes `ssh` as root or sudo.
