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
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/resale_erp_test",
    },
  },
});
