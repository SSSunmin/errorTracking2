import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the backend so the dashboard and API share an
// origin (no CORS, refresh cookie works). Override with VITE_API_TARGET.
// Two HTML entries: the dashboard app (index.html) and the standalone replay
// viewer (replay-viewer.html), which is deployed to a separate origin
// (VITE_REPLAY_ORIGIN) to isolate untrusted recordings.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "replay-viewer": fileURLToPath(new URL("./replay-viewer.html", import.meta.url))
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:4100",
        changeOrigin: true
      }
    }
  }
});
