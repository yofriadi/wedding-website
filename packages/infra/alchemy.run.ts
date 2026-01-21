import alchemy from "alchemy";
import { Astro } from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });

const app = await alchemy("wedding-website");

export const web = await Astro("web", {
  cwd: "../../apps/web",
  bindings: {
    DATABASE_URL: alchemy.secret.env.DATABASE_URL!,
    CORS_ORIGIN: alchemy.env.CORS_ORIGIN!,
    DATABASE_AUTH_TOKEN: alchemy.secret.env.DATABASE_AUTH_TOKEN!,
  },
});

console.log(`Web    -> ${web.url}`);

await app.finalize();
