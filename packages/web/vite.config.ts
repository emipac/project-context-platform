import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4318";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
