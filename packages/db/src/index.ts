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
      if (!cached) {
        cached = createClient({
          url: env.DATABASE_URL,
          ...(env.DATABASE_AUTH_TOKEN ? { authToken: env.DATABASE_AUTH_TOKEN } : {}),
        });
        // SQLite defaults to foreign_keys=OFF, which makes the FK clauses in
        // the schema decorative. The local sqlite3 client pins one connection
        // for its lifetime (only transaction()/reconnect() swap it) and the
        // pragma is per-connection, so issuing it once here covers every
        // future statement on this client.
        //
        // Remote (http/ws) libsql enforces FKs server-side and the pragma is
        // a no-op there. A failure here surfaces through the normal client
        // error path (503 at the route layer); it never leaves a connection
        // silently running with FKs off.
        void cached.execute("PRAGMA foreign_keys=ON").catch((err: unknown) => {
          console.error("[db] foreign_keys pragma failed:", err);
        });
      }
      const value = Reflect.get(cached, prop, cached);
      return typeof value === "function" ? value.bind(cached) : value;
    },
  });
}

export const db = drizzle({ client: lazyClient(), schema });
