import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createTestDatabase } from "./support/database";
import { startTestServer } from "./support/server";

test("an occupied wedding-like server cannot satisfy private test readiness", async () => {
  test.setTimeout(150_000);
  const database = createTestDatabase("server-ownership");
  let externalRequests = 0;
  const foreign = createServer((_request, response) => {
    externalRequests++;
    response.setHeader("Content-Type", "application/json");
    response.end('{"count":0}');
  });
  await new Promise<void>((resolve) => foreign.listen(0, "localhost", resolve));
  const address = foreign.address();
  if (!address || typeof address === "string") throw new Error("missing test address");
  try {
    await expect(startTestServer(database, address.port)).rejects.toThrow(/exited|port|ready/i);
    expect(externalRequests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      foreign.close((error) => (error ? reject(error) : resolve())),
    );
    database.dispose();
  }
});
