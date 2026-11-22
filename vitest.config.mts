import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." import alias as tsconfig.json, so tests resolve app imports.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Pure logic tests run in Node (fast). Component tests opt into a
    // browser-like DOM with a `// @vitest-environment jsdom` comment at the top.
    environment: "node",
    // e2e/ holds Playwright tests; they run with `npm run test:e2e`, not Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      // The plan's target: 70%+ on the logic (lib/) and the renderer.
      include: ["lib/**", "components/**"],
      exclude: ["**/*.test.*", "**/__generated__/**", "lib/schema/fixtures/**"],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
      reporter: ["text-summary", "html"],
    },
  },
});
