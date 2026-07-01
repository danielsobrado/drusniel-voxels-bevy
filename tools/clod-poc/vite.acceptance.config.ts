/// <reference types="vitest" />
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vite.config";

export default defineConfig((env) => {
  const base = typeof baseConfig === "function" ? baseConfig(env) : baseConfig;
  return mergeConfig(base, {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      hmr: false,
      watch: {
        ignored: ["**/*"],
      },
    },
  });
});
