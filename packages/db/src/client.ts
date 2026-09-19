import type { Client } from "@libsql/client";

// Async methods that must await connection readiness before dispatch.
const AWAIT_READY_METHODS = new Set([
  "execute",
  "batch",
  "transaction",
  "executeMultiple",
  "migrate",
  "sync",
]);

// Open lazily so database outages do not prevent routes from importing. Await
// foreign-key setup before queries, and retry initialization after transient errors.
export function createLazyClient(factory: () => Client): Client {
  let state: { client: Client; ready: Promise<void> } | undefined;
  function connect() {
    if (state) return state;
    const client = factory();
    const current = { client, ready: Promise.resolve() };
    state = current;
    current.ready = Promise.resolve()
      .then(async () => {
        await client.execute("PRAGMA foreign_keys=ON");
      })
      .catch((error: unknown) => {
        if (state === current) state = undefined;
        client.close();
        throw error;
      });
    // A synchronous property lookup can start initialization without a query.
    void current.ready.catch(() => {});
    return current;
  }
  return new Proxy({} as Client, {
    get(_target, property) {
      if (property === "close" || property === "reconnect") {
        return () => {
          state?.client.close();
          state = undefined;
        };
      }
      if (AWAIT_READY_METHODS.has(String(property))) {
        return async (...args: unknown[]) => {
          const current = connect();
          await current.ready;
          return Reflect.apply(Reflect.get(current.client, property), current.client, args);
        };
      }
      const { client } = connect();
      const value = Reflect.get(client, property, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}
