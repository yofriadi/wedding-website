import { createClient } from "@libsql/client";
import { env } from "@wedding-website/env/server";
import { drizzle } from "drizzle-orm/libsql";
import { createLazyClient } from "./client";
import * as schema from "./schema";

export const db = drizzle({
  client: createLazyClient(() =>
    createClient({
      url: env.DATABASE_URL,
      ...(env.DATABASE_AUTH_TOKEN ? { authToken: env.DATABASE_AUTH_TOKEN } : {}),
    }),
  ),
  schema,
});
