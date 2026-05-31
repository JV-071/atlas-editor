import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Read the version at config time via a runtime require so TS doesn't try
// to pull package.json into the tsconfig project file list.
const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Inject the package version at build time so the UI can never drift
  // from package.json (which the release bump keeps in sync).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
