import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/__adhd__/host": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__adhd__\/host/, "")
      },
      "/__adhd__/federation": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__adhd__\/federation/, "")
      }
    }
  }
});
