import { load } from "js-yaml";
import type { PropCategory } from "../../props/prop_types.js";
import { VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M } from "./constants.js";

export interface VegetationAuthorityExclusionConfig {
  readonly marginM: number;
  readonly unknownPropRadiusM: number;
  readonly propRadiusM: Readonly<Record<PropCategory, number>>;
}

const ROOT_KEYS = ["vegetation_authority_exclusions"] as const;
const EXCLUSION_KEYS = ["invalid_height_m", "margin_m", "unknown_prop_radius_m", "prop_radius_m"] as const;
const PROP_CATEGORY_KEYS = ["small_decor", "medium_static", "large_static", "vegetation", "interactive"] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function finiteNumber(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${path} must be a finite number >= ${minimum}`);
  }
  return value;
}

export function parseVegetationAuthorityExclusionConfig(source: string): VegetationAuthorityExclusionConfig {
  const document = record(load(source), "config");
  rejectUnknown(document, ROOT_KEYS, "config");
  const exclusions = record(document.vegetation_authority_exclusions, "vegetation_authority_exclusions");
  rejectUnknown(exclusions, EXCLUSION_KEYS, "vegetation_authority_exclusions");
  const radii = record(exclusions.prop_radius_m, "vegetation_authority_exclusions.prop_radius_m");
  rejectUnknown(radii, PROP_CATEGORY_KEYS, "vegetation_authority_exclusions.prop_radius_m");

  if (exclusions.invalid_height_m !== VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M) {
    throw new Error(`vegetation_authority_exclusions.invalid_height_m must be ${VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M}`);
  }

  return Object.freeze({
    marginM: finiteNumber(exclusions.margin_m, "vegetation_authority_exclusions.margin_m", 0),
    unknownPropRadiusM: finiteNumber(
      exclusions.unknown_prop_radius_m,
      "vegetation_authority_exclusions.unknown_prop_radius_m",
      Number.EPSILON,
    ),
    propRadiusM: Object.freeze({
      small_decor: finiteNumber(radii.small_decor, "vegetation_authority_exclusions.prop_radius_m.small_decor", Number.EPSILON),
      medium_static: finiteNumber(radii.medium_static, "vegetation_authority_exclusions.prop_radius_m.medium_static", Number.EPSILON),
      large_static: finiteNumber(radii.large_static, "vegetation_authority_exclusions.prop_radius_m.large_static", Number.EPSILON),
      vegetation: finiteNumber(radii.vegetation, "vegetation_authority_exclusions.prop_radius_m.vegetation", Number.EPSILON),
      interactive: finiteNumber(radii.interactive, "vegetation_authority_exclusions.prop_radius_m.interactive", Number.EPSILON),
    }),
  });
}
