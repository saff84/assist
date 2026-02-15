import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// Plugin to copy PDF.js worker to public directory
const copyPdfWorker = () => ({
  name: "copy-pdf-worker",
  buildStart() {
    const workerSource = path.resolve(import.meta.dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
    const workerDest = path.resolve(import.meta.dirname, "client/public/pdf.worker.min.mjs");
    
    if (fs.existsSync(workerSource)) {
      const publicDir = path.dirname(workerDest);
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.copyFileSync(workerSource, workerDest);
      console.log("✅ Copied PDF.js worker to public directory");
    } else {
      console.warn("⚠️ PDF.js worker source not found:", workerSource);
    }
  },
  writeBundle() {
    // Also copy to dist/public after build (in case emptyOutDir removes it)
    const workerSource = path.resolve(import.meta.dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
    const workerDest = path.resolve(import.meta.dirname, "dist/public/pdf.worker.min.mjs");
    
    if (fs.existsSync(workerSource)) {
      const publicDir = path.dirname(workerDest);
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.copyFileSync(workerSource, workerDest);
      console.log("✅ Copied PDF.js worker to dist/public directory");
    }
  },
});

const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), copyPdfWorker()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
