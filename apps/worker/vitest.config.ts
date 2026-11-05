import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve workspace packages from source so tests run on a clean checkout
// (no prior `npm run build` of packages/shared or packages/policy required).
const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ofp/shared": fromRoot("packages/shared/src/index.ts"),
      "@ofp/policy": fromRoot("packages/policy/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // DB suites start PostgreSQL (PGlite, WASM) and apply every migration in
    // beforeAll; that is CPU-bound and takes several seconds on small CI runners.
    hookTimeout: 60_000
  }
});
