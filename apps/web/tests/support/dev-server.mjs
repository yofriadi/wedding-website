import { dev } from "astro";

// Test-only launcher: use the actual bound address, not a guessed free port.
// Its private IPC message and nonce endpoint are never in the application build.
const token = process.env.WEDDING_TEST_SERVER_TOKEN;
if (!token || !process.send)
  throw new Error("Test launcher requires private IPC and an instance token");
const requestedPort = Number(process.env.WEDDING_TEST_SERVER_PORT ?? 0);
const server = await dev({
  root: process.cwd(),
  cacheDir: process.env.WEDDING_TEST_SERVER_CACHE,
  server: { host: "localhost", port: requestedPort },
  vite: {
    server: { strictPort: true },
    plugins: [
      {
        name: "private-test-server-identity",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== `/__test-instance/${token}`) return next();
            response.setHeader("Cache-Control", "no-store");
            response.end(token);
          });
        },
      },
    ],
  },
});
if (requestedPort !== 0 && server.address.port !== requestedPort) {
  await server.stop();
  throw new Error("Test server fell back to an unrequested port");
}
process.send({ type: "ready", port: server.address.port, token });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
process.on("disconnect", () => {
  void stop();
});
