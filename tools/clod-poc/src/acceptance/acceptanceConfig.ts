import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import type { AcceptanceConfig } from "./acceptanceTypes.js";
import { AcceptanceError } from "./acceptanceTypes.js";

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AcceptanceError("ConfigTypeError", `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function numberAt(raw: Record<string, unknown>, key: string, path: string, min = -Infinity, max = Infinity): number {
  const value = raw[key];
  if (value === undefined) throw new AcceptanceError("ConfigMissing", `missing required key ${path}.${key}`);
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

function boolAt(raw: Record<string, unknown>, key: string, path: string): boolean {
  const value = raw[key];
  if (value === undefined) throw new AcceptanceError("ConfigMissing", `missing required key ${path}.${key}`);
  if (typeof value !== "boolean") throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be boolean`);
  return value;
}

function stringAt(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (value === undefined) throw new AcceptanceError("ConfigMissing", `missing required key ${path}.${key}`);
  if (typeof value !== "string") throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be a string`);
  return value;
}

function intAt(raw: Record<string, unknown>, key: string, path: string, min: number, max = Infinity): number {
  const value = numberAt(raw, key, path, min, max);
  if (!Number.isInteger(value)) throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be an integer`);
  return value;
}

function positiveIntAt(raw: Record<string, unknown>, key: string, path: string, max = Infinity): number {
  return intAt(raw, key, path, 1, max);
}

function intArrayAt(raw: Record<string, unknown>, key: string, path: string, min: number, max = Infinity): number[] {
  const value = raw[key];
  if (value === undefined) throw new AcceptanceError("ConfigMissing", `missing required key ${path}.${key}`);
  if (!Array.isArray(value)) throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be an array`);
  for (const v of value) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || !Number.isInteger(v)) {
      throw new AcceptanceError("ConfigInvalid", `${path}.${key} entries must be integers in [${min}, ${max}]`);
    }
  }
  return value;
}

function logLevelAt(raw: Record<string, unknown>, key: string, path: string): "debug" | "info" | "warn" | "error" {
  const value = stringAt(raw, key, path);
  if (value !== "debug" && value !== "info" && value !== "warn" && value !== "error") {
    throw new AcceptanceError("ConfigInvalid", `${path}.${key} must be one of: debug, info, warn, error`);
  }
  return value;
}

export function parseAcceptanceConfig(text: string): AcceptanceConfig {
  const doc = asRecord(load(text), "root");
  const acceptance = asRecord(doc["acceptance"], "acceptance");
  const world = asRecord(acceptance["world"], "acceptance.world");
  const thresholds = asRecord(acceptance["thresholds"], "acceptance.thresholds");
  const visual = asRecord(acceptance["visual"], "acceptance.visual");
  const stressScenes = asRecord(acceptance["stress_scenes"], "acceptance.stress_scenes");
  const logging = asRecord(acceptance["logging"], "acceptance.logging");

  return {
    outputDir: stringAt(acceptance, "output_dir", "acceptance"),
    world: {
      lod0PagesX: positiveIntAt(world, "lod0_pages_x", "acceptance.world"),
      lod0PagesZ: positiveIntAt(world, "lod0_pages_z", "acceptance.world"),
      smokeLod0PagesX: positiveIntAt(world, "smoke_lod0_pages_x", "acceptance.world"),
      smokeLod0PagesZ: positiveIntAt(world, "smoke_lod0_pages_z", "acceptance.world"),
    },
    thresholds: {
      borderPositionEpsilon: numberAt(thresholds, "border_position_epsilon", "acceptance.thresholds", 0),
      borderNormalDotMin: numberAt(thresholds, "border_normal_dot_min", "acceptance.thresholds", 0, 1),
      borderMaterialWeightDeltaMax: numberAt(thresholds, "border_material_weight_delta_max", "acceptance.thresholds", 0),
      lod3TriangleRatioMax: numberAt(thresholds, "lod3_triangle_ratio_max", "acceptance.thresholds", 0, 1),
      lowBenefitRateMax: numberAt(thresholds, "low_benefit_rate_max", "acceptance.thresholds", 0, 1),
      fullHierarchyBuildMsMax: numberAt(thresholds, "full_hierarchy_build_ms_max", "acceptance.thresholds", 0),
      singleNodeRebuildMsMax: numberAt(thresholds, "single_node_rebuild_ms_max", "acceptance.thresholds", 0),
      densityScarScoreMax: numberAt(thresholds, "density_scar_score_max", "acceptance.thresholds", 0),
      visualHolePixelRatioMax: numberAt(thresholds, "visual_hole_pixel_ratio_max", "acceptance.thresholds", 0),
      visualLipPixelRatioMax: numberAt(thresholds, "visual_lip_pixel_ratio_max", "acceptance.thresholds", 0),
      requireMeasuredSingleNodeRebuild: boolAt(thresholds, "require_measured_single_node_rebuild", "acceptance.thresholds"),
    },
    visual: {
      enabled: boolAt(visual, "enabled", "acceptance.visual"),
      screenshotWidth: positiveIntAt(visual, "screenshot_width", "acceptance.visual"),
      screenshotHeight: positiveIntAt(visual, "screenshot_height", "acceptance.visual"),
      cameraFovYDeg: numberAt(visual, "camera_fov_y_deg", "acceptance.visual", 1, 179),
      grazingAngleDeg: numberAt(visual, "grazing_angle_deg", "acceptance.visual", 0, 90),
      crossfadeFrames: intAt(visual, "crossfade_frames", "acceptance.visual", 0),
    },
    stressScenes: {
      ridgeBorder: boolAt(stressScenes, "ridge_border", "acceptance.stress_scenes"),
      cliffCorner: boolAt(stressScenes, "cliff_corner", "acceptance.stress_scenes"),
      caveMouthBorder: boolAt(stressScenes, "cave_mouth_border", "acceptance.stress_scenes"),
      thinBridge: boolAt(stressScenes, "thin_bridge", "acceptance.stress_scenes"),
      forcedNeighborLodDeltas: intArrayAt(stressScenes, "forced_neighbor_lod_deltas", "acceptance.stress_scenes", 1, 3),
      nearFieldBubbleMask: boolAt(stressScenes, "near_field_bubble_mask", "acceptance.stress_scenes"),
    },
    logging: {
      level: logLevelAt(logging, "level", "acceptance.logging"),
    },
  };
}

export function loadAcceptanceConfig(path: string): AcceptanceConfig {
  const text = readFileSync(path, "utf-8");
  return parseAcceptanceConfig(text);
}

const _dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ACCEPTANCE_CONFIG_PATH = join(_dirname, "..", "..", "config", "clod_acceptance.yaml");
