# wedding-website

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Astro, Self, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Astro** - The web framework for content-driven websites
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Drizzle** - TypeScript-first ORM
- **SQLite** - Local file database
- **prek** - Git hooks for code quality
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

The application uses a SQLite file through Drizzle ORM. Copy the example env
file and adjust it — relative paths are resolved from `apps/web` at runtime:

```bash
cp apps/web/.env.example apps/web/.env
```

which sets:

```dotenv
DATABASE_URL=file:../../packages/db/local.db
```

The database file is NOT tracked by git (it holds guest data). `pnpm run
db:migrate` creates it from the committed migrations on first run:

```bash
pnpm run db:migrate
```

Use `pnpm run db:push` only for disposable development databases when you
intentionally want Drizzle to synchronize the current schema without migrations.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser to see the fullstack application.

## Deployment (standalone Node + reverse proxy)

The site runs as a standalone Node server behind a reverse proxy (Caddy with
auto-TLS terminates TLS and proxies to the node process) on a self-hosted VM.

Run it exactly as production does — note `pnpm dev` starts the Vite dev server,
which is NOT the same runtime:

```bash
cd apps/web
pnpm build
node dist/server/entry.mjs   # HOST/PORT/DATABASE_URL/NODE_ENV from the environment
```

### Production release checklist

On a fresh VM (or a new release), apply migrations BEFORE starting/restarting
the server — libSQL will happily auto-create an empty database file and the
site will look healthy while every invite query fails with `no such table`:

```bash
# from the repo root, with the PRODUCTION DATABASE_URL exported
DATABASE_URL=file:/srv/wedding/wedding.db pnpm run db:migrate   # must exit 0
systemctl restart wedding   # only after migrations succeeded
```

See `openspec/changes/invite-only-personalization/` for the deployment design.

## Git Hooks and Formatting

- Initialize hooks: `pnpm run prepare`
- Format and lint fix: `pnpm run check`

## Project Structure

```
wedding-website/
├── apps/
│   └── web/         # Fullstack application (Astro)
├── packages/
│   ├── config/      # Shared tooling config (tsconfig)
│   ├── db/          # Drizzle schema + migrations (SQLite)
│   └── env/         # Type-safe environment variables
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:studio`: Open database studio UI
- `pnpm run db:migrate`: Apply committed migrations (creates the DB on first run)
- `pnpm run check`: Run Oxlint and Oxfmt
