import { load } from "js-yaml";
import treesYaml from "../../config/trees.yaml?raw";

const DEFAULT_MAX_BUILD_MS_PER_FRAME = 2;
const MIN_MAX_BUILD_MS_PER_FRAME = 0.25;
const MAX_MAX_BUILD_MS_PER_FRAME = 16;

export interface TreeImpostorBakeConfig {
  maxBuildMsPerFrame: number;
}

export function parseTreeImpostorBakeConfig(
  yamlText: string,
  fallbackMs = DEFAULT_MAX_BUILD_MS_PER_FRAME,
): TreeImpostorBakeConfig {
  const root = asRecord(load(yamlText));
  const trees = asRecord(root.trees);
  const impostors = asRecord(trees.impostors);
  const parsed = Number(impostors.max_build_ms_per_frame);
  const value = Number.isFinite(parsed) ? parsed : fallbackMs;
  return {
    maxBuildMsPerFrame: clamp(value, MIN_MAX_BUILD_MS_PER_FRAME, MAX_MAX_BUILD_MS_PER_FRAME),
  };
}

export const TREE_IMPOSTOR_BAKE_CONFIG = parseTreeImpostorBakeConfig(treesYaml);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
