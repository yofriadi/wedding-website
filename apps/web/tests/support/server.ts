import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createTestDatabase, WEB_ROOT, type TestDatabase } from "./database";

async function availablePort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(new Error(`Test port is unavailable: ${error.message}`)));
    probe.listen(port, "localhost", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("No test port"));
      probe.close(() => resolve(address.port));
    });
  });
}

export async function startTestServer(
  database: TestDatabase,
  port = 0,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const token = randomUUID();
  const requestedPort = await availablePort(port);
  const logPath = join(database.workDir, "server.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const server = fork(join(WEB_ROOT, "tests/support/dev-server.mjs"), [], {
    cwd: WEB_ROOT,
    execArgv: [],
    env: {
      ...database.env,
      ...extraEnv,
      WEDDING_TEST_SERVER_TOKEN: token,
      WEDDING_TEST_SERVER_PORT: String(requestedPort),
      WEDDING_TEST_SERVER_CACHE: join(database.workDir, "astro-cache"),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
  });
  server.stdout?.pipe(log, { end: false });
  server.stderr?.pipe(log, { end: false });
  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", () =>
      reject(new Error(`Test server exited before readiness; see ${logPath}`)),
    );
    server.on("message", (message: unknown) => {
      const data = message as { type?: string; token?: string; port?: number };
      if (data?.type === "ready" && data.token === token && typeof data.port === "number")
        resolve(data.port);
    });
  });
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        /* already exited */
      }
      if (server.exitCode === null && server.signalCode === null) {
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      }
      // Background AVIF work cannot outlive disposal of this server's storage.
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }
    log.end();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const actualPort = await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Test server timed out; see ${logPath}`)),
          120_000,
        );
      }),
    ]);
    clearTimeout(timer);
    const baseUrl = `http://localhost:${actualPort}`;
    const identity = await fetch(`${baseUrl}/__test-instance/${token}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!identity.ok || (await identity.text()) !== token)
      throw new Error("Test listener identity mismatch");
    const count = await fetch(`${baseUrl}/api/rsvp/count`, { signal: AbortSignal.timeout(30_000) });
    if (!count.ok) throw new Error(`Test database is not ready; see ${logPath}`);
    return { baseUrl, stop, logPath };
  } catch (error) {
    clearTimeout(timer);
    await stop();
    throw error;
  }
}

export async function createTestServer(label: string) {
  const database = createTestDatabase(label);
  try {
    const server = await startTestServer(database);
    return {
      ...database,
      ...server,
      async dispose() {
        await server.stop();
        database.dispose();
      },
    };
  } catch (error) {
    database.dispose();
    throw error;
  }
}
