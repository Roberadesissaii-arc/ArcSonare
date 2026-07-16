import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned for Tauri development.
export default defineConfig({
  plugins: [react()],

  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    // Tauri expects a fixed port; fail if it is taken.
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust sources.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env variables starting with TAURI_ENV_* are exposed to the frontend.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri on Windows uses Chromium (WebView2); modern target is safe.
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
