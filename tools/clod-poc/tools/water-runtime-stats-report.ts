import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  WaterClipmap,
  WaterField,
  collectWaterClipmapRuntimeStats,
  parseWaterConfig,
  resolveWaterConfig,
  resolveWaterReflectionPolicy,
} from "../src/water/index.js";
import { createWaterShaderMaterial } from "../src/water/waterMaterial.js";
import { surfaceHeight } from "../src/terrain/terrain.js";

const WATER_CONFIG_PATH = "config/water.yaml";
const DEFAULT_WORLD_CELLS = 512;

function main(): void {
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

  try {
    clipmap.update(0.016, cameraPosition);
    const stats = collectWaterClipmapRuntimeStats(clipmap, scene, waterConfig.cellSizes);
    console.log(JSON.stringify({
      ok: true,
      worldCells: DEFAULT_WORLD_CELLS,
      waterEnabled: waterConfig.enabled,
      clipmap: stats,
      reflection: resolveWaterReflectionPolicy(waterConfig.visual.reflection, "webgl"),
    }, null, 2));
  } finally {
    clipmap.dispose();
  }
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
