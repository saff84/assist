import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "client/src/widget/main.tsx"),
      name: "SanextChatWidget",
      formats: ["iife"],
      fileName: () => "chat-widget.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: "chat-widget[extname]",
        inlineDynamicImports: true,
      },
    },
  },
});
