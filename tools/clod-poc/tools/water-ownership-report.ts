import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import {
  assertWaterOwnershipIsRuntimeOnly,
  createWaterOwnershipStats,
  parseWaterConfig,
  summarizeWaterOwnership,
} from "../src/water/index.js";

const WATER_CONFIG_PATH = "config/water.yaml";
const BORDER_COAST_CONFIG_PATH = "config/border_coast_ocean.yaml";

function readYamlRecord(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  return (load(text) ?? {}) as Record<string, unknown>;
}

function deepOceanEnabled(): boolean {
  const parsed = readYamlRecord(BORDER_COAST_CONFIG_PATH);
  const deepOcean = (parsed.deep_ocean ?? parsed.deepOcean ?? {}) as Record<string, unknown>;
  return deepOcean.enabled === true;
}

function main(): void {
  const waterConfig = parseWaterConfig(readFileSync(WATER_CONFIG_PATH, "utf8"));
  const stats = createWaterOwnershipStats({
    waterEnabled: waterConfig.enabled,
    clipmapEnabled: waterConfig.enabled,
    deepOceanEnabled: waterConfig.enabled && deepOceanEnabled(),
  });

  assertWaterOwnershipIsRuntimeOnly(stats);

  const report = {
    ok: true,
    rule: "water must stay outside CLOD page ownership",
    ownership: summarizeWaterOwnership(stats),
  };
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
