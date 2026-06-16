import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the backend so the dashboard and API share an
// origin (no CORS, refresh cookie works). Override with VITE_API_TARGET.
export default defineConfig({
  plugins: [react()],
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
