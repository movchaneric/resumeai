import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/globalSetup.js";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL, OPENAI_API_KEY: "test-key", BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0", AUTH_RATE_LIMIT: "off" },
    fileParallelism: false,
  },
});
