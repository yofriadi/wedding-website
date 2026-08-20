# wedding-website

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Astro, Self, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Astro** - The web framework for content-driven websites
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Drizzle** - TypeScript-first ORM
- **SQLite** - Local file database
- **Husky** - Git hooks for code quality
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

The application uses a SQLite file through Drizzle ORM. Add a file URL to
`apps/web/.env`; relative paths are resolved from `apps/web` at runtime:

```dotenv
DATABASE_URL=file:../../packages/db/local.db
```

Apply the committed migrations before starting the application:

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

## Deployment (Cloudflare via Alchemy)

- Dev: cd apps/web && pnpm run alchemy dev
- Deploy: cd apps/web && pnpm run deploy
- Destroy: cd apps/web && pnpm run destroy

For more details, see the guide on [Deploying to Cloudflare with Alchemy](https://www.better-t-stack.dev/docs/guides/cloudflare-alchemy).

## Git Hooks and Formatting

- Initialize hooks: `pnpm run prepare`
- Format and lint fix: `pnpm run check`

## Project Structure

```
wedding-website/
├── apps/
│   └── web/         # Fullstack application (Astro)
├── packages/
│   ├── api/         # API layer / business logic
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:studio`: Open database studio UI
- `pnpm run db:local`: Start the local SQLite database
- `pnpm run check`: Run Oxlint and Oxfmt
