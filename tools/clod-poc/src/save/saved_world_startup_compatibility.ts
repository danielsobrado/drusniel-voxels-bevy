import type { SaveWorldManifest } from "./save_schema.js";
import type { WorldManifest } from "../world/world_manifest.js";

export interface WorldManifestTarget {
  __drusnielWorldManifest?: WorldManifest;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function mismatch(failures: string[], label: string, saved: unknown, current: unknown): void {
  if (stableJson(saved) !== stableJson(current)) failures.push(`${label} changed`);
}

/**
 * Compares immutable generator identity. terrainSourceHash is intentionally excluded:
 * the current cache hash includes mutable voxel deltas and feature-stamp revisions.
 * startupWorld is also excluded because it is only the initial streaming budget.
 * Generator changes must bump generatorVersion.
 */
export function savedWorldManifestCompatibilityFailures(
  saved: WorldManifest,
  current: WorldManifest,
): string[] {
  const failures: string[] = [];
  mismatch(failures, "worldId", saved.worldId, current.worldId);
  mismatch(failures, "seed", saved.seed, current.seed);
  mismatch(failures, "generatorVersion", saved.generatorVersion, current.generatorVersion);
  mismatch(failures, "mode", saved.mode, current.mode);
  mismatch(failures, "size", saved.sizeM, current.sizeM);
  mismatch(failures, "sea level", saved.seaLevelM, current.seaLevelM);
  mismatch(failures, "generator artifacts", saved.artifacts, current.artifacts);
  return failures;
}

export function assertSavedWorldManifestCompatible(saved: WorldManifest, current: WorldManifest): void {
  const failures = savedWorldManifestCompatibilityFailures(saved, current);
  if (failures.length > 0) {
    throw new Error(`saved world is incompatible with the current generator: ${failures.join(", ")}`);
  }
}

function restoreManifestProperty(
  target: WorldManifestTarget,
  descriptor: PropertyDescriptor | undefined,
  value: WorldManifest | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, "__drusnielWorldManifest", descriptor);
    return;
  }
  delete target.__drusnielWorldManifest;
  if (value !== undefined) target.__drusnielWorldManifest = value;
}

/**
 * Installs before world build so every published manifest is checked fail-closed.
 * The returned disposer restores the exact prior property if activation later fails.
 */
export function installSavedWorldManifestCompatibilityGuard(
  target: WorldManifestTarget,
  saveManifest: SaveWorldManifest,
): () => void {
  if (saveManifest.schemaVersion !== 2 || !saveManifest.worldManifest) {
    throw new Error("saved world is missing a pinned schema-v2 world manifest");
  }

  const pinned = structuredClone(saveManifest.worldManifest) as WorldManifest;
  const descriptor = Object.getOwnPropertyDescriptor(target, "__drusnielWorldManifest");
  const previous = target.__drusnielWorldManifest;
  if (previous) assertSavedWorldManifestCompatible(pinned, previous);
  if (descriptor && descriptor.configurable === false) {
    throw new Error("world manifest diagnostics property is not configurable");
  }

  let current = previous;
  let active = true;
  Object.defineProperty(target, "__drusnielWorldManifest", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: WorldManifest | undefined) => {
      if (next) assertSavedWorldManifestCompatible(pinned, next);
      current = next;
    },
  });

  return () => {
    if (!active) return;
    active = false;
    restoreManifestProperty(target, descriptor, previous);
  };
}
