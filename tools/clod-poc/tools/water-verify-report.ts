import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { load } from "js-yaml";
import * as THREE from "three";
import {
  WaterClipmap,
  WaterField,
  assertWaterOwnershipIsRuntimeOnly,
  buildRiverTerrainWetnessMask,
  collectRiverTerrainWetnessMaskStats,
  collectWaterClipmapRuntimeStats,
  createWaterOwnershipStats,
  parseWaterConfig,
  resolveWaterConfig,
  resolveWaterReflectionPolicy,
  summarizeWaterOwnership,
} from "../src/water/index.js";
import { createWaterShaderMaterial } from "../src/water/waterMaterial.js";
import { surfaceHeight } from "../src/terrain/terrain.js";

const WATER_CONFIG_PATH = "config/water.yaml";
const BORDER_COAST_CONFIG_PATH = "config/border_coast_ocean.yaml";
const VERIFY_CONFIG_PATH = "config/water_verify.yaml";
const DEFAULT_WORLD_CELLS = 512;

type VerificationStatus = "pass" | "fail";

interface WaterVerifyConfig {
  output: { defaultPath: string };
  ownership: {
    requireRuntimeOnly: boolean;
    maxTerrainClodSurfaces: number;
  };
  clipmap: {
    requireEnabledWhenWaterEnabled: boolean;
    minVisibleLevelsWhenEnabled: number;
    minTrianglesWhenEnabled: number;
    maxTrianglesWhenEnabled: number;
  };
  reflection: {
    requireSafeFallback: boolean;
    allowUnwiredSsr: boolean;
  };
  wetnessMask: {
    enabled: boolean;
    resolution: number;
    minWetPixels: number;
    maxChannelValue: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function loadVerifyConfig(): WaterVerifyConfig {
  const root = asRecord(load(readFileSync(VERIFY_CONFIG_PATH, "utf8")));
  const config = asRecord(root.water_verify);
  const output = asRecord(config.output);
  const ownership = asRecord(config.ownership);
  const clipmap = asRecord(config.clipmap);
  const reflection = asRecord(config.reflection);
  const wetnessMask = asRecord(config.wetness_mask);

  return {
    output: {
      defaultPath: stringValue(output.default_path, "qa-runs/water/water-verify-report.json"),
    },
    ownership: {
      requireRuntimeOnly: boolValue(ownership.require_runtime_only, true),
      maxTerrainClodSurfaces: numberValue(ownership.max_terrain_clod_surfaces, 0),
    },
    clipmap: {
      requireEnabledWhenWaterEnabled: boolValue(clipmap.require_enabled_when_water_enabled, true),
      minVisibleLevelsWhenEnabled: numberValue(clipmap.min_visible_levels_when_enabled, 1),
      minTrianglesWhenEnabled: numberValue(clipmap.min_triangles_when_enabled, 1),
      maxTrianglesWhenEnabled: numberValue(clipmap.max_triangles_when_enabled, 250_000),
    },
    reflection: {
      requireSafeFallback: boolValue(reflection.require_safe_fallback, true),
      allowUnwiredSsr: boolValue(reflection.allow_unwired_ssr, false),
    },
    wetnessMask: {
      enabled: boolValue(wetnessMask.enabled, true),
      resolution: numberValue(wetnessMask.resolution, 128),
      minWetPixels: numberValue(wetnessMask.min_wet_pixels, 1),
      maxChannelValue: numberValue(wetnessMask.max_channel_value, 255),
    },
  };
}

function parseOutPath(args: readonly string[], fallback: string): string {
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && args[outIndex + 1]) return args[outIndex + 1];
  return fallback;
}

function deepOceanEnabled(): boolean {
  const parsed = asRecord(load(readFileSync(BORDER_COAST_CONFIG_PATH, "utf8")));
  const deepOcean = asRecord(parsed.deep_ocean ?? parsed.deepOcean);
  return deepOcean.enabled === true;
}

function addCheck(checks: string[], failures: string[], ok: boolean, message: string): void {
  checks.push(`${ok ? "PASS" : "FAIL"}: ${message}`);
  if (!ok) failures.push(message);
}

function main(): void {
  const verifyConfig = loadVerifyConfig();
  const outPath = parseOutPath(process.argv.slice(2), verifyConfig.output.defaultPath);
  const waterConfig = resolveWaterConfig(
    parseWaterConfig(readFileSync(WATER_CONFIG_PATH, "utf8")),
    DEFAULT_WORLD_CELLS,
  );

  const scene = new THREE.Scene();
  const cameraPosition = new THREE.Vector3(DEFAULT_WORLD_CELLS * 0.5, 80, DEFAULT_WORLD_CELLS * 0.5);
  const field = new WaterField(waterConfig, { surfaceHeight });
  const clipmap = new WaterClipmap({
    scene,
    config: waterConfig,
    field,
    createMaterial: (params) => createWaterShaderMaterial(params),
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
    cameraPosition,
    worldBounds: { cellsX: DEFAULT_WORLD_CELLS, cellsZ: DEFAULT_WORLD_CELLS },
  });
  const wetnessMask = verifyConfig.wetnessMask.enabled
    ? buildRiverTerrainWetnessMask({
        field,
        worldCells: DEFAULT_WORLD_CELLS,
        resolution: verifyConfig.wetnessMask.resolution,
      })
    : null;

  try {
    clipmap.update(0.016, cameraPosition);
    const ownershipStats = createWaterOwnershipStats({
      waterEnabled: waterConfig.enabled,
      clipmapEnabled: waterConfig.enabled,
      deepOceanEnabled: waterConfig.enabled && deepOceanEnabled(),
    });
    const clipmapStats = collectWaterClipmapRuntimeStats(clipmap, scene, waterConfig.cellSizes);
    const reflectionPolicy = resolveWaterReflectionPolicy(waterConfig.visual.reflection, "webgl");
    const wetnessStats = collectRiverTerrainWetnessMaskStats(wetnessMask);

    const checks: string[] = [];
    const failures: string[] = [];

    if (verifyConfig.ownership.requireRuntimeOnly) {
      try {
        assertWaterOwnershipIsRuntimeOnly(ownershipStats);
        addCheck(checks, failures, true, "water ownership remains runtime-only");
      } catch (error) {
        addCheck(checks, failures, false, error instanceof Error ? error.message : String(error));
      }
    }
    addCheck(
      checks,
      failures,
      ownershipStats.terrainClodSurfaces <= verifyConfig.ownership.maxTerrainClodSurfaces,
      "terrain CLOD owns zero water surfaces",
    );

    if (waterConfig.enabled && verifyConfig.clipmap.requireEnabledWhenWaterEnabled) {
      addCheck(checks, failures, clipmapStats.enabled, "clipmap is enabled when water is enabled");
    }
    if (waterConfig.enabled) {
      addCheck(
        checks,
        failures,
        clipmapStats.visibleLevelCount >= verifyConfig.clipmap.minVisibleLevelsWhenEnabled,
        "clipmap has visible water levels",
      );
      addCheck(
        checks,
        failures,
        clipmapStats.triangleCount >= verifyConfig.clipmap.minTrianglesWhenEnabled,
        "clipmap emits water triangles",
      );
      addCheck(
        checks,
        failures,
        clipmapStats.triangleCount <= verifyConfig.clipmap.maxTrianglesWhenEnabled,
        "clipmap triangle count is inside budget",
      );
    }

    if (verifyConfig.reflection.requireSafeFallback) {
      addCheck(
        checks,
        failures,
        reflectionPolicy.activeMode === "sky_terrain_fallback",
        "reflection has a safe fallback mode",
      );
    }
    if (!verifyConfig.reflection.allowUnwiredSsr) {
      addCheck(
        checks,
        failures,
        !reflectionPolicy.ssrRequested || reflectionPolicy.ssrActive,
        "SSR is not requested unless runtime-wired",
      );
    }

    if (verifyConfig.wetnessMask.enabled) {
      addCheck(checks, failures, wetnessStats.enabled, "wetness mask was generated");
      addCheck(
        checks,
        failures,
        wetnessStats.wetPixels >= verifyConfig.wetnessMask.minWetPixels,
        "wetness mask has wet pixels",
      );
      addCheck(
        checks,
        failures,
        wetnessStats.maxWet <= verifyConfig.wetnessMask.maxChannelValue
          && wetnessStats.maxFoam <= verifyConfig.wetnessMask.maxChannelValue
          && wetnessStats.maxDroplets <= verifyConfig.wetnessMask.maxChannelValue,
        "wetness mask channels stay inside byte range",
      );
    }

    const report = {
      status: failures.length === 0 ? "pass" as VerificationStatus : "fail" as VerificationStatus,
      generatedAt: new Date().toISOString(),
      worldCells: DEFAULT_WORLD_CELLS,
      checks,
      failures,
      ownership: summarizeWaterOwnership(ownershipStats),
      clipmap: clipmapStats,
      reflection: reflectionPolicy,
      wetnessMask: wetnessStats,
    };

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    wetnessMask?.dispose();
    clipmap.dispose();
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
