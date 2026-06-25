// Shared config contract. Node-side loading lives in config_node.ts so this module
// and the browser viewer never pull in node:fs.
import { load } from "js-yaml";

export interface DiagonalFlipConfig {
  enabled: boolean;
  min_triangle_area: number;
  min_normal_dot: number;
  min_angle_improvement_degrees: number;
  normal_error_weight: number;
  angle_quality_weight: number;
  material_error_weight: number;
}

export const DEFAULT_DIAGONAL_FLIP_CONFIG: DiagonalFlipConfig = {
  enabled: true,
  min_triangle_area: 0.000001,
  min_normal_dot: 0.05,
  min_angle_improvement_degrees: 2.0,
  normal_error_weight: 1.0,
  angle_quality_weight: 1.0,
  material_error_weight: 0.25,
};

export interface PocConfig {
  lod0_pages_x: number;
  lod0_pages_z: number;
  smoke_lod0_pages_x: number;
  smoke_lod0_pages_z: number;
  emit_debug_json: boolean;
  emit_debug_obj: boolean;
}

export interface ValidationConfig {
  position_epsilon: number;
  normal_dot_min: number;
  material_weight_epsilon: number;
  zero_area_epsilon: number;
}

export interface ClodPagesConfig {
  page: {
    chunks_per_page: number;
    chunk_size: number;
    halo_chunks: number;
    quadtree_levels: number;
  };
  simplify: {
    target_ratio_per_level: number;
    abandon_ratio: number;
    target_error: number;
    weld_epsilon_cells: number;
    attribute_weights: { normal: number; material: number };
  };
  polish: {
    diagonal_flip: DiagonalFlipConfig;
  };
  selection: {
    error_threshold_px: number;
    hysteresis_merge_factor: number;
    neighbor_level_delta_max: number;
    transition_mode: "instant" | "dither";
    crossfade_frames: number;
  };
  near_field: { radius_chunks: number };
  meshopt_package_version: string;
  poc: PocConfig;
  validation: ValidationConfig;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function numberAt(raw: Record<string, unknown>, key: string, path: string, min = -Infinity, max = Infinity): number {
  const value = raw[key];
  if (value === undefined) throw new Error(`missing required key ${path}.${key}`);
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path}.${key} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

function boolAt(raw: Record<string, unknown>, key: string, path: string): boolean {
  const value = raw[key];
  if (value === undefined) throw new Error(`missing required key ${path}.${key}`);
  if (typeof value !== "boolean") throw new Error(`${path}.${key} must be boolean`);
  return value;
}

function stringAt(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (value === undefined) throw new Error(`missing required key ${path}.${key}`);
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string`);
  return value;
}

function intAt(raw: Record<string, unknown>, key: string, path: string, min: number, max = Infinity): number {
  const value = numberAt(raw, key, path, min, max);
  if (!Number.isInteger(value)) throw new Error(`${path}.${key} must be an integer`);
  return value;
}

function positiveIntAt(raw: Record<string, unknown>, key: string, path: string, max = Infinity): number {
  const value = intAt(raw, key, path, 1, max);
  return value;
}

function diagConfig(raw: Record<string, unknown>, prefix: string): DiagonalFlipConfig {
  const section = asRecord(raw["diagonal_flip"], `${prefix}.diagonal_flip`);
  return {
    enabled: boolAt(section, "enabled", `${prefix}.diagonal_flip`),
    min_triangle_area: numberAt(section, "min_triangle_area", `${prefix}.diagonal_flip`, 0),
    min_normal_dot: numberAt(section, "min_normal_dot", `${prefix}.diagonal_flip`, 0),
    min_angle_improvement_degrees: numberAt(section, "min_angle_improvement_degrees", `${prefix}.diagonal_flip`, 0),
    normal_error_weight: numberAt(section, "normal_error_weight", `${prefix}.diagonal_flip`, 0),
    angle_quality_weight: numberAt(section, "angle_quality_weight", `${prefix}.diagonal_flip`, 0),
    material_error_weight: numberAt(section, "material_error_weight", `${prefix}.diagonal_flip`, 0),
  };
}

/** Strict parse. Every missing or invalid key fails loudly. */
export function parseConfig(text: string): ClodPagesConfig {
  const doc = asRecord(load(text), "root");
  const page = asRecord(doc["page"], "page");
  const simplify = asRecord(doc["simplify"], "simplify");
  const attrWeights = asRecord(simplify["attribute_weights"], "simplify.attribute_weights");
  const polish = asRecord(doc["polish"], "polish");
  const selection = asRecord(doc["selection"], "selection");
  const near_field = asRecord(doc["near_field"], "near_field");
  const poc = asRecord(doc["poc"], "poc");
  const validation = asRecord(doc["validation"], "validation");

  const transitionMode = stringAt(selection, "transition_mode", "selection");
  if (transitionMode !== "instant" && transitionMode !== "dither") {
    throw new Error("selection.transition_mode must be 'instant' or 'dither'");
  }

  return {
    page: {
      chunks_per_page: positiveIntAt(page, "chunks_per_page", "page"),
      chunk_size: positiveIntAt(page, "chunk_size", "page"),
      halo_chunks: intAt(page, "halo_chunks", "page", 0),
      quadtree_levels: positiveIntAt(page, "quadtree_levels", "page"),
    },
    simplify: {
      target_ratio_per_level: numberAt(simplify, "target_ratio_per_level", "simplify", 0, 1),
      abandon_ratio: numberAt(simplify, "abandon_ratio", "simplify", 0, 1),
      target_error: numberAt(simplify, "target_error", "simplify", 0),
      weld_epsilon_cells: numberAt(simplify, "weld_epsilon_cells", "simplify", 0),
      attribute_weights: {
        normal: numberAt(attrWeights, "normal", "simplify.attribute_weights", 0),
        material: numberAt(attrWeights, "material", "simplify.attribute_weights", 0),
      },
    },
    polish: {
      diagonal_flip: diagConfig(polish, "polish"),
    },
    selection: {
      error_threshold_px: numberAt(selection, "error_threshold_px", "selection", Number.MIN_VALUE),
      hysteresis_merge_factor: numberAt(selection, "hysteresis_merge_factor", "selection", 1),
      neighbor_level_delta_max: positiveIntAt(selection, "neighbor_level_delta_max", "selection"),
      transition_mode: transitionMode as "instant" | "dither",
      crossfade_frames: intAt(selection, "crossfade_frames", "selection", 0),
    },
    near_field: {
      radius_chunks: intAt(near_field, "radius_chunks", "near_field", 0),
    },
    meshopt_package_version: stringAt(doc, "meshopt_package_version", "root"),
    poc: {
      lod0_pages_x: positiveIntAt(poc, "lod0_pages_x", "poc"),
      lod0_pages_z: positiveIntAt(poc, "lod0_pages_z", "poc"),
      smoke_lod0_pages_x: positiveIntAt(poc, "smoke_lod0_pages_x", "poc"),
      smoke_lod0_pages_z: positiveIntAt(poc, "smoke_lod0_pages_z", "poc"),
      emit_debug_json: boolAt(poc, "emit_debug_json", "poc"),
      emit_debug_obj: boolAt(poc, "emit_debug_obj", "poc"),
    },
    validation: {
      position_epsilon: numberAt(validation, "position_epsilon", "validation", 0),
      normal_dot_min: numberAt(validation, "normal_dot_min", "validation", 0, 1),
      material_weight_epsilon: numberAt(validation, "material_weight_epsilon", "validation", 0),
      zero_area_epsilon: numberAt(validation, "zero_area_epsilon", "validation", 0),
    },
  };
}
