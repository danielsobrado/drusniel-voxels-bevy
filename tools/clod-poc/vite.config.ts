/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// The shared config lives at repo-root config/clod_pages.yaml (one source of truth),
// imported via `?raw`. Allow Vite to read up to the repo root (two levels up).
export default defineConfig({
  base: "/drusniel-voxels-bevy/",
  server: { fs: { allow: ["../.."] } },
  build: {
    target: "es2022"
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/reference/**",
      "**/.{idea,git,cache,output,temp}/**"
    ]
  }
});
