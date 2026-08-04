import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Rebuilds the disposable ogc_test PostGIS fixture once per run when
    // OGC_TEST_DATABASE_URL is set; a no-op otherwise (integration suites
    // skip themselves without a database).
    globalSetup: ["tests/ogc/global-setup.ts"],
  },
});
