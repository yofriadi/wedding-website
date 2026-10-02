# 💍 Wedding Website

A modern, high-performance, and beautifully crafted wedding website with personalized guest invitations, family RSVP management, and a live guest photo wall.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![docker-image](https://github.com/yofriadi/wedding-website/actions/workflows/docker-image.yml/badge.svg)](https://github.com/yofriadi/wedding-website/actions/workflows/docker-image.yml)
[![Built with Astro](https://img.shields.io/badge/Built%20with-Astro-ff5d01.svg)](https://astro.build)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8.svg)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/Database-SQLite%20%2F%20libSQL-003b57.svg)](https://sqlite.org)

---

## ✨ Features

- **Personalized Guest Experience**: Share unique links (`/<invite-id>`) that greet each guest by name with an elegant swipe-to-open entrance gate.
- **Family & Group Invitations**: Send one link to an entire household with atomic slot claiming (`maxMembers`), so each family member can RSVP and upload photos independently.
- **Interactive RSVP**: Real-time attendance confirmation with optimistic UI updates, celebratory confetti, and live attendance metrics.
- **Live Guest Photo Trail**: Guests can upload a memory directly from their phone into an interactive, physics-driven photo trail and gallery.
- **Cinematic Storytelling & Visuals**:
  - Scroll-driven story timeline and photo parallax collage.
  - Editorial typography with `@fontsource-variable/fraunces` and `@fontsource-variable/geist`.
  - Ambient background music player with smooth fade-in.
  - Interactive Leaflet & OpenStreetMap venue navigation with custom pins.
  - Full support for `prefers-reduced-motion` and light/dark theme contrast.
- **High-Performance Media Pipeline**:
  - Automatic WebP canonical normalization, EXIF/metadata stripping, and background AVIF generation.
  - Multi-resolution responsive image `srcset` (390px, 768px, 1280px) and ultra-lightweight blurhash-style placeholders.
- **Self-Hosted & Privacy-First**:
  - Single Docker container deployment with zero vendor lock-in.
  - Persistent SQLite database + volume storage.
  - Built-in Caddy configuration for automatic Let's Encrypt SSL/TLS and zstd compression.
  - Public repository ships clean placeholders so you can open-source your code without exposing private family memories.

---

## 🛠️ Tech Stack

| Layer                  | Technology                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**          | [Astro 7](https://astro.build/) (SSR with `@astrojs/node` standalone adapter)                                                  |
| **Styling**            | [Tailwind CSS v4](https://tailwindcss.com/)                                                                                    |
| **Animations**         | [Motion](https://motion.dev/) (Framer Motion engine) & CSS scroll-driven timelines                                             |
| **Database**           | [SQLite](https://sqlite.org/) via [libSQL](https://github.com/tursodatabase/libsql) & [Drizzle ORM](https://orm.drizzle.team/) |
| **Media Processing**   | [Sharp](https://sharp.pixelplumbing.com/) (WebP & AVIF pipelines)                                                              |
| **Maps**               | [Leaflet](https://leafletjs.com/) & [OpenStreetMap](https://www.openstreetmap.org/)                                            |
| **Monorepo & Tooling** | [Turborepo](https://turbo.build/), [pnpm](https://pnpm.io/), [oxlint](https://oxc.rs/), [oxfmt](https://oxc.rs/)               |
| **Deployment**         | [Docker Compose](https://docs.docker.com/compose/) & [Caddy](https://caddyserver.com/)                                         |

---

## 🚀 Quick Start

Get a local development server running in under two minutes:

### 1. Prerequisites

- **Node.js**: v20 or higher
- **pnpm**: v9 or v10 (`corepack enable && corepack prepare pnpm@latest --activate`)

### 2. Clone & Install

```sh
git clone https://github.com/yofriadi/wedding-website.git
cd wedding-website
pnpm install
```

### 3. Configure Environment

Copy the example environment file:

```sh
cp apps/web/.env.example apps/web/.env
```

_(The defaults work out-of-the-box for local development with a local SQLite database at `packages/db/local.db`)_

### 4. Initialize Database & Run

```sh
# Apply database baseline migration
pnpm run db:migrate

# Start the development server
pnpm run dev
```

Visit [`http://localhost:4321`](http://localhost:4321) in your browser! 🎉

---

## 💌 Invitations & Admin API

Invitations are identified by unique 12-character URL slugs (e.g., `https://your-wedding.com/abc123xyz789`).

### 1. Set Your Admin Token

Set an admin token in `apps/web/.env`:

```sh
INVITE_ADMIN_TOKEN="your-secure-admin-token-at-least-32-chars"
```

### 2. Create an Individual Invitation

```sh
curl -X POST http://localhost:4321/api/admin/<YOUR_TOKEN>/invites \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Budi Santoso"}'
```

**Response:**

```json
{
  "id": "7fqX6Jl1EPwM",
  "sharePath": "/7fqX6Jl1EPwM",
  "type": "individual"
}
```

Share the link: `http://localhost:4321/7fqX6Jl1EPwM`. When the guest opens it:

- The site records the visit and binds a cookie.
- The entrance gate greets the guest personally by name ("Untuk: Budi Santoso").
- Opening the envelope unlocks personalized RSVP options and photo upload.

### 3. Create a Group / Family Invitation

For households or friend groups where multiple guests share one link:

```sh
curl -X POST http://localhost:4321/api/admin/<YOUR_TOKEN>/invites \
  -H "Content-Type: application/json" \
  -d '{"displayName": "The Santoso Family", "type": "group", "maxMembers": 4}'
```

**Response:**

```json
{
  "id": "sSQusFJJxJyE",
  "sharePath": "/sSQusFJJxJyE",
  "type": "group",
  "maxMembers": 4
}
```

- Visitors opening this link see an entry claim gate where each member enters their name (e.g. "Maya").
- A slot is claimed atomically (`POST /api/invite/claim`), giving them their own sticky identity, personalized greeting, RSVP, and photo upload slot.
- Once the group reaches capacity (`maxMembers`), additional visitors can still view the invitation in read-only mode.

### 4. Monitor RSVPs & Guest Attendance

Retrieve a real-time JSON breakdown of all invitations, attendance, and member claims:

```sh
curl http://localhost:4321/api/admin/<YOUR_TOKEN>/invites
```

Or inspect the database visually using Drizzle Studio:

```sh
pnpm run db:studio
```

---

## 🎨 Customizing for Your Wedding

Make this website your own by updating the following components:

| Section                   | File                                           | Description                                            |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| **Couple Names & Date**   | `apps/web/src/components/HeroZoom.astro`       | Main hero title, date string, and animated text        |
| **Family & Lineage**      | `apps/web/src/components/FamiliesReveal.astro` | Bride/groom parents, blessings, and lineage copy       |
| **Event Schedule**        | `apps/web/src/components/EventTimes.astro`     | Ceremony (Akad), reception times, and dress code       |
| **Venue & Coordinates**   | `apps/web/src/lib/venue.ts`                    | Venue name, city, latitude, and longitude for the map  |
| **Love Story / Timeline** | `apps/web/src/components/TimelineScroll.astro` | Milestones, story narrative, and relationship photos   |
| **Wedding FAQ**           | `apps/web/src/components/WeddingFAQ.astro`     | Dress code, parking, schedules, dining style           |
| **Loading Phrases**       | `apps/web/src/lib/loading-phrases.ts`          | Playful text shimmer phrases during initial asset load |
| **Background Music**      | `apps/web/public/`                             | Place your licensed `*.mp3` soundtrack in `public/`    |
| **Photos & Imagery**      | `apps/web/public/`                             | Replace hero and memories photos (see below)           |

---

## 🖼️ Media & Responsive Variants

### Public Placeholders vs. Private Media

This repository includes lightweight **placeholder images and video** so anyone can clone and run the site immediately without downloading private personal files.

When you are ready to use your own photos:

1. Replace images in `apps/web/public/` with your own photos (using matching filenames and dimensions, or updating component references).
2. Generate responsive variants:
   ```sh
   pnpm --filter web run media:variants
   ```
   This generates optimized AVIF + WebP resolution ladders (390px, 768px, 1280px) and low-res blurred placeholders into `apps/web/public/generated/`.

#### Private Media Workflow (Optional)

If you wish to keep personal media out of git while deploying or developing locally, you can store your masters in `originals/private-media/` and use:

```sh
tools/restore-private-media.sh          # overlays real media and sets git skip-worktree
tools/restore-private-media.sh --undo   # reverts back to placeholders
```

> [!WARNING]
> **Turbo Remote Cache**: Generated image derivatives are stored in `apps/web/public/generated/` and gitignored. If you use Turbo Remote Cache, be aware that build artifacts containing derivatives of personal photos could be uploaded to your remote cache.

---

## 🚢 Deployment

### Recommended: Docker Compose on a VPS

Everything (Astro Node server, SQLite database, and guest photo storage) runs in a single lightweight container with volume persistence:

```sh
# 1. Copy the Docker environment file and add your admin token
cp env.docker.example .env
# Edit .env and set INVITE_ADMIN_TOKEN (generate with: openssl rand -hex 32)

# 2. Build and run
docker compose up -d --build
```

### With Automatic HTTPS (Caddy)

If you have a domain pointed to your server's IP:

```sh
# 1. Copy and configure Caddyfile
cp Caddyfile.example Caddyfile
# Edit Caddyfile and replace with your actual domain

# 2. Launch with Caddy reverse proxy (handles Let's Encrypt SSL automatically)
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

For full VPS setup instructions, automated backups, and cache tuning, see **[DEPLOY.md](DEPLOY.md)**.

---

## 📂 Project Structure

```text
wedding-website/
├── apps/
│   └── web/                   # Astro application (pages, components, APIs)
│       ├── public/            # Static assets & media placeholders
│       │   └── generated/     # Generated responsive AVIF/WebP variants (gitignored)
│       └── src/
│           ├── components/    # UI components (Hero, RSVP, Map, Timeline, Gates)
│           ├── layouts/       # Root HTML layout and global styles
│           ├── lib/           # Business logic (RSVP, invite session, image encode)
│           └── pages/         # Routes (/[id] invite landing, /api endpoints)
├── packages/
│   ├── config/                # Shared TypeScript and tooling configs
│   ├── db/                    # Drizzle schema, SQLite connection, and migrations
│   └── env/                   # Type-safe environment variable validation
├── ops/                       # Operational scripts (backups, restore drills, moderation)
├── tools/                     # Placeholder integrity assertion and media helpers
├── DEPLOY.md                  # Comprehensive production deployment guide
├── SPEC.md                    # Detailed invite, group claiming & API protocol specs
└── NOTE.md                    # Manual testing & walkthrough notes
```

---

## ⌨️ Available Commands

| Command                                  | Description                                                    |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm run dev`                           | Start development server on `localhost:4321`                   |
| `pnpm run build`                         | Build production bundle (generates media variants + SSR build) |
| `pnpm run check-types`                   | Typecheck all workspaces (`astro check` & `tsc`)               |
| `pnpm run check`                         | Run linter (`oxlint`) and auto-formatter (`oxfmt`)             |
| `pnpm run db:migrate`                    | Apply latest SQLite database migrations                        |
| `pnpm run db:generate`                   | Generate migration SQL after Drizzle schema changes            |
| `pnpm run db:studio`                     | Open Drizzle Studio visual database inspector                  |
| `pnpm --filter web exec playwright test` | Run end-to-end integration test suite                          |

---

## 📚 Further Documentation

- **[DEPLOY.md](DEPLOY.md)** — Production VPS deployment with Docker, Caddy, SSL, and backups.
- **[SPEC.md](SPEC.md)** — In-depth architectural specs for the invitation protocol, group claiming, and database constraints.
- **[NOTE.md](NOTE.md)** — Step-by-step isolated development and manual testing guide.
- **[ops/README.md](ops/README.md)** — Production operations, backup scripts, restore drills, and cache policies.
- **[ops/MODERATION.md](ops/MODERATION.md)** — Guidelines for reviewing and moderating guest photo uploads.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/yofriadi/wedding-website/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
