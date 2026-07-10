// Water ownership report.
//
// Two layers:
//  1. System-level: the legacy renderer-count summary (water must never be owned by CLOD
//     terrain pages).
//  2. Per-sample oracle: walks a world-space sample grid through the same WaterField/
//     exclusion-band wiring the runtime water controller uses and verifies that every
//     hydrology-wet point has exactly one renderer owner:
//       - clipmap owns wet points outside the deep-ocean exclusion band;
//       - deep ocean owns the band (when enabled) and the clipmap must be dry there;
//       - the shore-surf band is the one intentional weighted overlap and is exempted.
//     Exit code 1 on zero-owner (dry gap) or double-owner (double render) samples.
//
// Usage: npx tsx tools/water-ownership-report.ts [worldCells]
// NOTE: concrete module imports, not the src/water barrel — the barrel re-exports
// surfBand.js whose chain imports a `.wgsl?raw` module that only Vite can load.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import {
  assertWaterOwnershipIsRuntimeOnly,
  createWaterOwnershipStats,
  summarizeWaterOwnership,
} from "../src/water/waterOwnership.js";
import { parseWaterConfig, resolveWaterConfig } from "../src/water/water_config_parsing.js";
import { HydrologySystem } from "../src/water/hydrologySystem.js";
import { WaterField } from "../src/water/waterField.js";
import { parseBorderCoastOceanConfig, type BorderCoastOceanConfig } from "../src/terrain/border_coast_config.js";
import { surfaceHeight } from "../src/terrain/terrain.js";

const root = resolve(import.meta.dirname, "..");
const WATER_CONFIG_PATH = resolve(root, "config/water.yaml");
const BORDER_COAST_CONFIG_PATH = resolve(root, "config/border_coast_ocean.yaml");

function readYamlRecord(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  return (load(text) ?? {}) as Record<string, unknown>;
}

function deepOceanEnabled(): boolean {
  const parsed = readYamlRecord(BORDER_COAST_CONFIG_PATH);
  const deepOcean = (parsed.deep_ocean ?? parsed.deepOcean ?? {}) as Record<string, unknown>;
  return deepOcean.enabled === true;
}

function loadBorderCoastConfig(): BorderCoastOceanConfig | undefined {
  try {
    return parseBorderCoastOceanConfig(readFileSync(BORDER_COAST_CONFIG_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

interface OwnershipFailure {
  x: number;
  z: number;
  kind: "zero-owner" | "double-owner";
  hydrologyWet: boolean;
  owners: string[];
}

function main(): void {
  const worldCells = Number(process.argv[2] ?? 1024);
  const waterConfigRaw = parseWaterConfig(readFileSync(WATER_CONFIG_PATH, "utf8"));
  const waterConfig = resolveWaterConfig(waterConfigRaw, worldCells);

  // --- layer 1: system-level summary (unchanged contract) ---
  const stats = createWaterOwnershipStats({
    waterEnabled: waterConfig.enabled,
    clipmapEnabled: waterConfig.enabled,
    deepOceanEnabled: waterConfig.enabled && deepOceanEnabled(),
  });
  assertWaterOwnershipIsRuntimeOnly(stats);

  // --- layer 2: per-sample oracle, mirroring the water controller wiring ---
  // Mirrors readShoreSurfSettings / deepOceanClipmapExclusionDistance from
  // water_controller_params.ts (not imported: that module pulls the Vite-only barrel).
  const borderCoast = loadBorderCoastConfig();
  const oceanEnabled = Boolean(borderCoast?.enabled && borderCoast.deepOcean.enabled);
  const exclusionDistance = oceanEnabled && borderCoast ? Math.max(0, borderCoast.coast.oceanStartCells) : 0;
  const surf = {
    enabled: Boolean(borderCoast?.enabled),
    startDistance: borderCoast?.coast.oceanStartCells ?? 0,
    fullSurfDistance: borderCoast?.coast.oceanFullDepthCells ?? 0,
    level: borderCoast?.ocean.surfaceY ?? 0,
    maxShallowDepth: borderCoast ? Math.min(2.5, borderCoast.ocean.minDepth) : 2.5,
  };

  const sampler = { surfaceHeight };
  const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, sampler, { infiniteWorldSamples: true });
  const field = new WaterField(waterConfig, sampler, hydrology, worldCells);
  field.setShoreSurfBand(surf);
  field.setClipmapExclusionBand({ enabled: exclusionDistance > 0, distance: exclusionDistance });

  const cellSize = waterConfig.cellSizes[0] ?? 1.5;
  const failures: OwnershipFailure[] = [];
  let sampleCount = 0;
  let wetSamples = 0;
  let bandSamples = 0;
  let surfOverlapSamples = 0;

  const insideWorld = (x: number, z: number): boolean => x >= 0 && z >= 0 && x <= worldCells && z <= worldCells;
  const edgeDistance = (x: number, z: number): number => Math.min(x, z, worldCells - x, worldCells - z);

  for (let z = -256; z <= worldCells + 256; z += 32) {
    for (let x = -256; x <= worldCells + 256; x += 32) {
      sampleCount++;
      const inWorld = insideWorld(x, z);
      const inBand = inWorld && exclusionDistance > 0 && edgeDistance(x, z) < exclusionDistance;
      const inSurf = inWorld && surf.enabled && edgeDistance(x, z) < surf.startDistance;
      if (inBand) bandSamples++;
      if (inSurf) surfOverlapSamples++;

      const hydro = hydrology.sample(x, z, cellSize);
      const hydrologyWet = hydro.bodyMask > 0.05 && hydro.depth > 0.25;
      if (hydrologyWet) wetSamples++;

      const fieldSample = field.sampleForCellSize(x, z, cellSize);
      const clipmapOwns = fieldSample.bodyMask > 1e-4 && fieldSample.waterY - fieldSample.terrainY > 0;
      const oceanOwns = inBand && oceanEnabled;

      const owners: string[] = [];
      if (clipmapOwns) owners.push("clipmap");
      if (oceanOwns) owners.push("deep_ocean");

      // The shore-surf band is the intentional weighted overlap zone.
      if (owners.length > 1 && !inSurf) {
        failures.push({ x, z, kind: "double-owner", hydrologyWet, owners });
      }
      // Hydrology-wet ground must be rendered by someone. Inside the exclusion band the
      // deep ocean must own it; elsewhere the clipmap must.
      if (hydrologyWet && owners.length === 0) {
        failures.push({ x, z, kind: "zero-owner", hydrologyWet, owners });
      }
    }
  }

  const ok = failures.length === 0;
  const report = {
    ok,
    rule: "water must stay outside CLOD page ownership; every wet sample has exactly one owner",
    ownership: summarizeWaterOwnership(stats),
    oracle: {
      worldCells,
      sampleCount,
      wetSamples,
      bandSamples,
      surfOverlapSamples,
      exclusionDistance,
      deepOceanEnabled: oceanEnabled,
      zeroOwnerFailures: failures.filter((f) => f.kind === "zero-owner").length,
      doubleOwnerFailures: failures.filter((f) => f.kind === "double-owner").length,
      firstFailures: failures.slice(0, 10),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
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
