# Docker deployment (VPS)

Everything runs in one container: the Astro standalone Node server, SQLite,
and guest-photo storage. Data lives in a named Docker volume (`wedding-data`),
so rebuilding, upgrading, or removing the container never touches your data —
and `docker compose down -v` is the single command that erases everything.

## One-time setup on the VPS

```sh
# 1. Install Docker (official convenience script), then log out/in once:
curl -fsSL https://get.docker.com | sh

# 2. Get the code onto the VPS (git clone is simplest):
git clone <your-repo-url> ~/wedding && cd ~/wedding

# 3. Create the compose environment file:
cp env.docker.example .env
# Generate a real admin token and paste it into .env:
openssl rand -hex 32

# 3b. OPTIONAL — deploy the real personal photos instead of the placeholders:
# copy the private media (gitignored locally) onto the VPS with the same layout,
# then restore it over the placeholders. Docker builds read from disk, not git.
#   rsync -a originals/private-media/ this-host:~/wedding/
#   ./tools/restore-private-media.sh   # on the VPS; also restores the mp3

# 4. Build and start (migrations run automatically on container start):
docker compose up -d --build

# 5. Verify:
docker compose ps
curl -sI http://127.0.0.1:4321 | head -1
```

Open `http://<vps-ip>:4321` (allow port 4321 in your firewall, e.g. UFW).

Notes:

- Build on the VPS itself (step 4 does this). If you instead build on your
  Mac and push an image, you must build for the VPS architecture
  (`docker buildx build --platform linux/amd64`).
- The first build takes a few minutes; later rebuilds reuse cached layers.

## Pointing a domain at it

Cheapest reliable option: install Caddy on the host (one static binary) as a
reverse proxy with automatic HTTPS:

```
# /etc/caddy/Caddyfile
wedding.example.com {
    reverse_proxy 127.0.0.1:4321
}
```

Then change the compose port mapping to `"127.0.0.1:4321:4321"` so the app is
only reachable through Caddy.

## Updating after a code change

```sh
cd ~/wedding
git pull
docker compose up -d --build     # rebuilds, migrates, restarts; data persists
docker image prune -f            # optional: drop the dangling old image
```

## Backups

The database and uploaded photos live in the `wedding-website_wedding-data`
volume. Back it up periodically:

```sh
docker run --rm -v wedding-website_wedding-data:/data -v "$PWD/backup":/backup \
  alpine tar czf /backup/wedding-data-$(date +%F).tar.gz -C /data .
```

Restore by extracting that tarball into a fresh volume before first start.

## Removing everything (clean VPS)

```sh
docker compose down -v      # stops the app and deletes the data volume
docker image rm wedding-website:latest
docker system prune -f      # optional: clear build cache
```

After this, nothing from the app remains on the host outside `~/wedding`
(and the Docker engine itself, if you also uninstall it).

## Runtime details

- On every container start, `packages/db/scripts/migrate.mjs` applies
  migrations before the server starts (no-op if already applied). The
  migration guard refuses incompatible/legacy databases, so a fresh volume is
  always safe.
- `DATABASE_URL=file:/data/wedding.db` and `PHOTO_STORAGE_DIR=/data/photos`
  are set inside the image; adjust in `docker-compose.yml` if needed.
- Optional knobs (`PHOTO_AVIF_ENABLED`, `INVITE_COOKIE_DAYS`) come from the
  root `.env` file — see `env.docker.example`.
