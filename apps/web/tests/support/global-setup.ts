import { createTestDatabase } from "./database";
import { startTestServer } from "./server";

export default async function globalSetup() {
  const database = createTestDatabase("playwright");
  try {
    const server = await startTestServer(database);
    // Test workers inherit this only after setup. Never reuse a developer server
    // or trust an inherited DATABASE_URL/PHOTO_STORAGE_DIR for mutation tests.
    process.env.PLAYWRIGHT_BASE_URL = server.baseUrl;
    return async () => {
      await server.stop();
      database.dispose();
    };
  } catch (error) {
    database.dispose();
    throw error;
  }
}
