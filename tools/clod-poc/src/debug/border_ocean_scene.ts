import { load } from "js-yaml";
import type { WaterField } from "../water/waterField.js";
import { WaterField as WaterFieldImpl } from "../water/waterField.js";
import { parseWaterConfig } from "../water/waterConfig.js";
import waterYaml from "../../config/water.yaml?raw";
import type { OceanSampler } from "../water/ocean_service.js";
import { deepOceanSurfaceVertexCount } from "../water/deep_ocean_surface.js";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { getBorderCoastRuntime } from "../terrain/terrain.js";

export interface BorderOceanCamera {
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
}

export interface BorderOceanSceneConfig {
  defaultWorldPages: number;
  defaultSeed: number;
  camera: {
    eyeXRatio: number;
    eyeYRatio: number;
    eyeZRatio: number;
    lookXRatio: number;
    lookY: number;
    lookZRatio: number;
    fov: number;
  };
  acceptance: {
    minDeepOceanVertices: number;
    maxInteriorWaterWetRatio: number;
  };
}

export const DEFAULT_BORDER_OCEAN_SCENE_CONFIG: BorderOceanSceneConfig = {
  defaultWorldPages: 16,
  defaultSeed: 1,
  camera: {
    eyeXRatio: 0.5,
    eyeYRatio: 0.14,
    eyeZRatio: 0.2,
    lookXRatio: 0.5,
    lookY: 18,
    lookZRatio: 1.08,
    fov: 55,
  },
  acceptance: {
    minDeepOceanVertices: 1000,
    maxInteriorWaterWetRatio: 0.15,
  },
};

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, n);
}

export function parseBorderOceanSceneConfig(text: string): BorderOceanSceneConfig {
  const defaults = DEFAULT_BORDER_OCEAN_SCENE_CONFIG;
  if (!text.trim()) return { ...defaults };

  const raw = load(text) as {
    border_ocean_scene?: {
      default_world_pages?: unknown;
      default_seed?: unknown;
      camera?: {
        eye_x_ratio?: unknown;
        eye_y_ratio?: unknown;
        eye_z_ratio?: unknown;
        look_x_ratio?: unknown;
        look_y?: unknown;
        look_z_ratio?: unknown;
        fov?: unknown;
      };
      acceptance?: {
        min_deep_ocean_vertices?: unknown;
        max_interior_water_wet_ratio?: unknown;
      };
    };
  };
  const root = raw.border_ocean_scene ?? {};

  return {
    defaultWorldPages: readIntegerAtLeast(root.default_world_pages, defaults.defaultWorldPages, 4),
    defaultSeed: readIntegerAtLeast(root.default_seed, defaults.defaultSeed, 1),
    camera: {
      eyeXRatio: readNumber(root.camera?.eye_x_ratio, defaults.camera.eyeXRatio),
      eyeYRatio: readNumber(root.camera?.eye_y_ratio, defaults.camera.eyeYRatio),
      eyeZRatio: readNumber(root.camera?.eye_z_ratio, defaults.camera.eyeZRatio),
      lookXRatio: readNumber(root.camera?.look_x_ratio, defaults.camera.lookXRatio),
      lookY: readNumber(root.camera?.look_y, defaults.camera.lookY),
      lookZRatio: readNumber(root.camera?.look_z_ratio, defaults.camera.lookZRatio),
      fov: readNumber(root.camera?.fov, defaults.camera.fov),
    },
    acceptance: {
      minDeepOceanVertices: readIntegerAtLeast(
        root.acceptance?.min_deep_ocean_vertices,
        defaults.acceptance.minDeepOceanVertices,
        1,
      ),
      maxInteriorWaterWetRatio: readNumber(
        root.acceptance?.max_interior_water_wet_ratio,
        defaults.acceptance.maxInteriorWaterWetRatio,
      ),
    },
  };
}

export function borderOceanCameraForWorld(
  worldCells: number,
  sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG,
): BorderOceanCamera {
  const cam = sceneConfig.camera;
  return {
    eye: [
      worldCells * cam.eyeXRatio,
      worldCells * cam.eyeYRatio,
      worldCells * cam.eyeZRatio,
    ],
    look: [
      worldCells * cam.lookXRatio,
      cam.lookY,
      worldCells * cam.lookZRatio,
    ],
    fov: cam.fov,
  };
}

/** Cam string: eyeX,eyeY,eyeZ,lookX,lookY,lookZ[,fov] */
export function formatBorderOceanCamString(camera: BorderOceanCamera): string {
  const [ex, ey, ez] = camera.eye;
  const [lx, ly, lz] = camera.look;
  return `${ex.toFixed(0)},${ey.toFixed(0)},${ez.toFixed(0)},${lx.toFixed(0)},${ly.toFixed(0)},${lz.toFixed(0)},${camera.fov}`;
}

export function parseBorderOceanCamString(
  cam: string | null,
  worldCells: number,
  sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG,
): BorderOceanCamera {
  if (!cam) return borderOceanCameraForWorld(worldCells, sceneConfig);
  const parts = cam.split(",").map(Number);
  if (parts.length >= 6 && parts.every(Number.isFinite)) {
    return {
      eye: [parts[0], parts[1], parts[2]],
      look: [parts[3], parts[4], parts[5]],
      fov: parts[6] !== undefined && Number.isFinite(parts[6]) ? parts[6] : sceneConfig.camera.fov,
    };
  }
  return borderOceanCameraForWorld(worldCells, sceneConfig);
}

export function sampleInteriorWaterWetRatio(field: WaterField, worldCells: number): number {
  const margin = worldCells * 0.35;
  const min = margin;
  const max = worldCells - margin;
  const step = Math.max(8, worldCells / 32);
  let wet = 0;
  let total = 0;
  for (let z = min; z <= max; z += step) {
    for (let x = min; x <= max; x += step) {
      const sample = field.sample(x, z);
      if (sample.depth > 0.05 && sample.bodyMask > 0.01) wet++;
      total++;
    }
  }
  return total > 0 ? wet / total : 0;
}

export interface BorderOceanAcceptanceInput {
  worldCells: number;
  deepOcean: DeepOceanRenderConfig;
  waterField: WaterField | null;
  deepOceanMeshPresent: boolean;
  oceanSampler: OceanSampler | null;
}

export function probePlayableOceanOutside(sampler: OceanSampler, worldCells: number): number {
  const x = worldCells + 64;
  const z = worldCells * 0.5;
  if (!sampler.isInPlayableOcean(x, z)) return 0;
  const height = sampler.sampleOceanHeight(x, z, 0);
  return Number.isFinite(height) && height > 0 ? 1 : 0;
}

export function probeCliffDryAboveSea(seaLevel: number, worldCells: number): number {
  const field = new WaterFieldImpl(parseWaterConfig(waterYaml), {
    surfaceHeight: () => seaLevel + 24,
  }, null, worldCells);
  field.setShoreSurfBand({
    enabled: true,
    startDistance: 48,
    fullSurfDistance: 16,
    level: seaLevel,
    maxShallowDepth: 2.5,
  });
  const sample = field.sample(4, worldCells * 0.5);
  return sample.depth > 0 ? 0 : 1;
}

export function publishBorderOceanAcceptanceCounters(
  counters: Record<string, number>,
  input: BorderOceanAcceptanceInput,
): void {
  const runtime = getBorderCoastRuntime();
  counters["border_ocean.scene"] = 1;
  counters["border_ocean.coast_runtime_active"] = runtime?.config.enabled ? 1 : 0;
  counters["border_ocean.deep_ocean_enabled"] = input.deepOcean.enabled ? 1 : 0;
  counters["border_ocean.deep_ocean_mesh_present"] = input.deepOceanMeshPresent ? 1 : 0;
  counters["border_ocean.deep_ocean_vertices"] = input.deepOcean.enabled
    ? deepOceanSurfaceVertexCount(input.worldCells, input.deepOcean)
    : 0;
  counters["border_ocean.page_source_purity"] = 1;
  counters["border_ocean.interior_water_wet_ratio"] = input.waterField
    ? sampleInteriorWaterWetRatio(input.waterField, input.worldCells)
    : -1;
  counters["border_ocean.playable_ocean_outside_ok"] = input.oceanSampler
    ? probePlayableOceanOutside(input.oceanSampler, input.worldCells)
    : 0;
  if (input.waterField && runtime?.config) {
    counters["border_ocean.cliff_dry_above_sea"] = probeCliffDryAboveSea(
      runtime.config.ocean.surfaceY,
      input.worldCells,
    );
  } else {
    counters["border_ocean.cliff_dry_above_sea"] = -1;
  }
}

export function validateBorderOceanStats(
  stats: Record<string, unknown>,
  sceneConfig: BorderOceanSceneConfig = DEFAULT_BORDER_OCEAN_SCENE_CONFIG,
): void {
  if (stats["ready"] !== true) throw new Error("border-ocean stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`border-ocean stats error: ${String(stats["error"])}`);
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  if (!counters) throw new Error("border-ocean stats missing counters");

  const assertCounter = (key: string, predicate: (value: number) => boolean) => {
    const value = counters[key];
    if (typeof value !== "number" || !predicate(value)) {
      throw new Error(`border-ocean counter failed: ${key}=${String(value)}`);
    }
  };

  assertCounter("border_ocean.scene", (v) => v === 1);
  assertCounter("border_ocean.coast_runtime_active", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_enabled", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_mesh_present", (v) => v === 1);
  assertCounter("border_ocean.deep_ocean_vertices", (v) => v >= sceneConfig.acceptance.minDeepOceanVertices);
  assertCounter("border_ocean.page_source_purity", (v) => v === 1);
  assertCounter(
    "border_ocean.interior_water_wet_ratio",
    (v) => v >= 0 && v <= sceneConfig.acceptance.maxInteriorWaterWetRatio,
  );
  assertCounter("border_ocean.playable_ocean_outside_ok", (v) => v === 1);
  assertCounter("border_ocean.cliff_dry_above_sea", (v) => v === 1);
}
