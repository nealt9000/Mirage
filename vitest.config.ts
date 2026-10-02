import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the dev API middleware.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
    environment: "node",
  },
});
