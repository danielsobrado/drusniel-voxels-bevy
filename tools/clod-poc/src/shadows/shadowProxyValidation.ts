import type { ShadowProxyConfig, ShadowProxyCoverage, ShadowProxySource } from "./shadowProxyTypes.js";
import { sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";

export interface ShadowProxyValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateShadowProxyConfig(config: ShadowProxyConfig): ShadowProxyValidationResult {
  if (!Number.isFinite(config.gridRes) || config.gridRes < 2) {
    return { ok: false, reason: "gridRes must be >= 2" };
  }
  if (!Number.isFinite(config.endM) || config.endM <= 0) {
    return { ok: false, reason: "endM must be > 0" };
  }
  if (!Number.isFinite(config.startM) || config.startM < 0) {
    return { ok: false, reason: "startM must be >= 0" };
  }
  if (config.startM >= config.endM) {
    return { ok: false, reason: "startM must be < endM" };
  }
  if (config.minHeightM > config.maxHeightM) {
    return { ok: false, reason: "minHeightM must be <= maxHeightM" };
  }
  return { ok: true };
}

export function validateTerrainSummarySource(
  terrainSummary: ShadowProxySource | null | undefined,
): ShadowProxyValidationResult {
  if (!terrainSummary) {
    return { ok: false, reason: "terrain summary missing" };
  }
  if (!Number.isFinite(terrainSummary.worldSize) || terrainSummary.worldSize <= 0) {
    return { ok: false, reason: "terrain summary worldSize invalid" };
  }
  if (!Number.isFinite(terrainSummary.res) || terrainSummary.res < 1) {
    return { ok: false, reason: "terrain summary res invalid" };
  }
  if (!terrainSummary.heightMax || terrainSummary.heightMax.length === 0) {
    return { ok: false, reason: "terrain summary heightMax empty" };
  }
  return { ok: true };
}

export function computeShadowProxyCoverage(
  worldSize: number,
  config: ShadowProxyConfig,
  centerX = worldSize / 2,
  centerZ = worldSize / 2,
): ShadowProxyCoverage {
  return {
    centerX,
    centerZ,
    extentM: config.endM,
  };
}

export function clampProxyHeight(value: number, config: ShadowProxyConfig): number {
  if (!Number.isFinite(value)) return config.minHeightM;
  return Math.max(config.minHeightM, Math.min(config.maxHeightM, value));
}

export function ringFadeWeight(dist: number, config: ShadowProxyConfig): number {
  const inner = config.startM;
  const outer = config.endM;
  const fade = Math.max(0, config.edgeFadeM);
  if (dist < inner) {
    if (fade <= 0) return 0;
    return Math.max(0, Math.min(1, (dist - (inner - fade)) / fade));
  }
  if (dist > outer) {
    if (fade <= 0) return 0;
    return Math.max(0, Math.min(1, ((outer + fade) - dist) / fade));
  }
  return 1;
}

export function sampleProxyHeight(
  terrainSummary: ShadowProxySource,
  x: number,
  z: number,
  config: ShadowProxyConfig,
  dist: number,
): number {
  const farBase = summaryBaseLevel(terrainSummary);
  const raw = sampleSkirtHeight(
    terrainSummary,
    x,
    z,
    config.endM,
    farBase,
    1.0,
  );
  const biased = clampProxyHeight(raw + config.heightBiasM, config);
  const fade = ringFadeWeight(dist, config);
  return farBase + (biased - farBase) * fade;
}
