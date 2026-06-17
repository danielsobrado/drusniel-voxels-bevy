// Node-only loader for the shared config (spike / headless build). Kept separate from
// config.ts so the browser viewer bundle never imports node:fs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ClodPagesConfig, parseConfig } from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = resolve(HERE, "../config/clod_pages.yaml");

let cached: ClodPagesConfig | null = null;

export function loadConfig(): ClodPagesConfig {
  if (!cached) cached = parseConfig(readFileSync(CONFIG_PATH, "utf8"));
  return cached;
}
