/**
 * Vitest global setup for the OGC integration tests.
 *
 * Runs once per `vitest` invocation, before any test file. When
 * OGC_TEST_DATABASE_URL is set, it (re)builds the disposable ogc_test
 * fixture schema so every integration test file sees identical data even
 * when files run in parallel workers. When the variable is not set, the
 * integration suites skip themselves and this setup is a no-op.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "ogc_schema_fixture.sql",
);

/** Refuses to run DDL against anything that is not clearly a test
 * database; the fixture drops and recreates the ogc_test schema. */
function assertDisposableDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!/test|fixture/i.test(databaseName)) {
    throw new Error(
      `Refusing to rebuild the ogc_test fixture in database "${databaseName}"; ` +
        `OGC_TEST_DATABASE_URL must point to a disposable database whose name contains "test" or "fixture"`,
    );
  }
}

export default async function setup(): Promise<void> {
  const databaseUrl = process.env.OGC_TEST_DATABASE_URL;
  if (!databaseUrl) {
    return;
  }
  assertDisposableDatabase(databaseUrl);

  const fixtureSql = readFileSync(FIXTURE_PATH, "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(fixtureSql);
  } finally {
    await client.end();
  }
}
