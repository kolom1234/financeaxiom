import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the workspace package source so dev, e2e and build work without a prior package build.
    alias: {
      "@ofp/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
    }
  }
});
