import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["client/src/**/*.test.{ts,tsx}"],
    setupFiles: [],
    alias: {
      "@one2novel/shared": new URL("../shared/types", import.meta.url).pathname,
    },
  },
});
