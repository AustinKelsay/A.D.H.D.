import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || "127.0.0.1",
    port: 1420,
    strictPort: true
  }
});
