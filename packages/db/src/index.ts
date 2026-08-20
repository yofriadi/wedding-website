import { createClient } from "@libsql/client";
import { env } from "@wedding-website/env/server";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const client = createClient({
  url: env.DATABASE_URL,
  ...(env.DATABASE_AUTH_TOKEN ? { authToken: env.DATABASE_AUTH_TOKEN } : {}),
});

export const db = drizzle({ client, schema });
