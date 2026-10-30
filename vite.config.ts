import { defineConfig } from "vite";

// El build genera todo en ./dist, que Wrangler publica como Static Assets.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        admin: "admin/index.html",
      },
    },
  },
});
