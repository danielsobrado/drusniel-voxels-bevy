/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  // Production (GitHub Pages) is served from a repo sub-path, so builds need that base.
  // Dev serves from root so the local URL is simply http://localhost:5180/ — no base-path
  // to mistype, and no confusion with the clod-poc project (base "/drusniel-voxels-bevy/").
  base: command === "build" ? "/drusniel-voxels-web/" : "/",
  server: {
    // Pinned + strict so this project never silently lands on a different port, and so a
    // clash with another local Vite project (e.g. clod-poc on the default 5173) fails loudly
    // instead of quietly serving the wrong app.
    port: 5180,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  test: {
    setupFiles: ["./src/test-setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/reference/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
}));
