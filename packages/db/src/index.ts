import { createClient, type Client } from "@libsql/client";
import { env } from "@wedding-website/env/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

// `createClient` opens the SQLite file eagerly and throws on an unreachable
// path, which would 500 every importing route at module-load time. Wrap it in a
// Proxy that materializes the client on first property access so pages can
// degrade gracefully when the DB is unavailable (see index.astro, invite/me).
function lazyClient(): Client {
  let cached: Client | undefined;
  return new Proxy({} as Client, {
    get(_target, prop) {
      cached ??= createClient({
        url: env.DATABASE_URL,
        ...(env.DATABASE_AUTH_TOKEN ? { authToken: env.DATABASE_AUTH_TOKEN } : {}),
      });
      const value = Reflect.get(cached, prop, cached);
      return typeof value === "function" ? value.bind(cached) : value;
    },
  });
}

export const db = drizzle({ client: lazyClient(), schema });
