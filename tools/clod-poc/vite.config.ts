import { defineConfig } from "vite";

// The shared config lives at repo-root config/clod_pages.yaml (one source of truth),
// imported via `?raw`. Allow Vite to read up to the repo root (two levels up).
export default defineConfig({
  base: "/drusniel-voxels-bevy/",
  server: { fs: { allow: ["../.."] } },
});
