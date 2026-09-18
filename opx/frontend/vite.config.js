import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// React plugin + the "@" shortcut so imports look like shadcn docs.
// The dev server proxies /api to the backend so there are no CORS headaches
// and no hard-coded port in the app code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
