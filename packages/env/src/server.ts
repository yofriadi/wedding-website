import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().min(1).optional(),
    CORS_ORIGIN: z.url().optional(),
    INVITE_ADMIN_TOKEN: z.string().min(32).optional(),
    INVITE_COOKIE_DAYS: z.coerce.number().int().positive().default(30),
    // Guest photo storage root (guest-submissions D4): a local content
    // directory OUTSIDE the web root, e.g. /srv/wedding/photos/. Falls back
    // to a dev-relative dir so local runs work without config; production
    // sets it explicitly.
    PHOTO_STORAGE_DIR: z.string().min(1).default("./var/photos"),
    // AVIF variant generation (photo-normalization): AVIF is ~35% smaller than
    // the canonical WebP but ~4x slower to encode. It runs in a background
    // queue AFTER the upload response, so it can never slow a guest's post —
    // but on a small VM it is still CPU worth being able to switch off without
    // a deploy. Off = canonical WebP only; existing variants keep being served.
    // Enum-not-coerce on purpose: z.coerce.boolean() maps the STRING "false"
    // to true (Boolean("false")), which would invert the kill switch. The
    // preprocess only lowercases, so `TRUE` works while a typo still fails loud.
    PHOTO_AVIF_ENABLED: z
      .preprocess(
        (value) => (typeof value === "string" ? value.toLowerCase() : value),
        z.enum(["true", "false", "1", "0"]),
      )
      .default("true")
      .transform((value) => value === "true" || value === "1"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
