import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Nothing fancy. React plugin + the "@" shortcut so imports look like shadcn docs.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
