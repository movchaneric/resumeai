import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts"],
    env: { DATABASE_URL: "postgresql://resume:resume@localhost:15432/resume_ai_test" },
    fileParallelism: false,
  },
});
