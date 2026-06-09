import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const isDesktopRelativeBaseBuild = process.env.ONE2NOVEL_CLIENT_BASE === "relative";

export default defineConfig({
  base: isDesktopRelativeBaseBuild ? "./" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 7457,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:7456",
    },
  },
});
