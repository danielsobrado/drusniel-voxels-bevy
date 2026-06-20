import type { ProceduralTextureConfig } from "./materialRecipes.js";
import type { ProceduralTextureManifest } from "./textureManifest.js";

export type ProceduralCacheStatus = "missing" | "stale" | "match";

export interface ProceduralCacheSnapshot {
  manifest?: ProceduralTextureManifest;
  files: ReadonlySet<string>;
}

export function manifestOutputFiles(manifest: ProceduralTextureManifest): string[] {
  return [
    manifest.outputs.noiseA,
    manifest.outputs.noiseB,
    manifest.outputs.classificationA,
    ...manifest.outputs.terrainAlbedo,
    ...manifest.outputs.terrainNormalRoughness,
  ];
}

export function proceduralCacheStatus(
  expected: ProceduralTextureManifest,
  cache: ProceduralCacheSnapshot,
): ProceduralCacheStatus {
  if (!cache.manifest) return "missing";
  if (
    cache.manifest.schemaVersion !== expected.schemaVersion
    || cache.manifest.seed !== expected.seed
    || cache.manifest.configHash !== expected.configHash
    || cache.manifest.shaderHash !== expected.shaderHash
  ) {
    return "stale";
  }
  return manifestOutputFiles(expected).every((file) => cache.files.has(file)) ? "match" : "missing";
}

export function shouldGenerateProceduralOutputs(
  config: Pick<ProceduralTextureConfig, "runtime_mode">,
  status: ProceduralCacheStatus,
): boolean {
  if (config.runtime_mode === "force_regenerate") return true;
  if (config.runtime_mode === "cache_only") return false;
  return status !== "match";
}
