import * as THREE from "three";
import type { ShadowProxyConfig, ShadowProxyCoverage, ShadowProxySource, ShadowProxyStats } from "./shadowProxyTypes.js";
import {
  computeShadowProxyCoverage,
  ringFadeWeight,
  sampleProxyHeight,
  validateShadowProxyConfig,
  validateTerrainSummarySource,
} from "./shadowProxyValidation.js";

function emptyStats(config: ShadowProxyConfig): ShadowProxyStats {
  return {
    enabled: config.enabled,
    built: false,
    gridRes: config.gridRes,
    vertexCount: 0,
    triangleCount: 0,
    buildMs: 0,
    worldMinX: 0,
    worldMaxX: 0,
    worldMinZ: 0,
    worldMaxZ: 0,
    minHeight: 0,
    maxHeight: 0,
    castShadow: config.castShadow,
    receiveShadow: config.receiveShadow,
    mainPassColorWrite: config.mainPassColorWrite,
    mainPassDepthWrite: config.mainPassDepthWrite,
  };
}

export interface ShadowProxyGeometryResult {
  geometry: THREE.BufferGeometry | null;
  stats: ShadowProxyStats;
  error?: string;
}

export interface ShadowProxyGeometryJob {
  /** Advance sampling by ~budgetMs of CPU time; returns the result once complete, null while pending. */
  step(budgetMs: number): ShadowProxyGeometryResult | null;
}

/** Samples between budget checks; one batch must stay well under a frame. */
const BUDGET_CHECK_INTERVAL = 32;

/**
 * Incremental heightfield build so streaming rebuilds never stall a frame:
 * height sampling dominates the cost (procedural query per vertex), so it is
 * sliced across step() calls; index/normal generation runs in the completing
 * step. Normals come from height central differences instead of
 * computeVertexNormals — equivalent for a heightfield, and O(n) cheap.
 */
export function createShadowProxyGeometryJob(
  terrainSummary: ShadowProxySource | null | undefined,
  config: ShadowProxyConfig,
  coverage?: ShadowProxyCoverage,
): ShadowProxyGeometryJob {
  const configCheck = validateShadowProxyConfig(config);
  if (!configCheck.ok) {
    const failed: ShadowProxyGeometryResult = { geometry: null, stats: emptyStats(config), error: configCheck.reason };
    return { step: () => failed };
  }
  const summaryCheck = validateTerrainSummarySource(terrainSummary);
  if (!summaryCheck.ok || !terrainSummary) {
    const failed: ShadowProxyGeometryResult = { geometry: null, stats: emptyStats(config), error: summaryCheck.reason };
    return { step: () => failed };
  }

  const resolvedCoverage = coverage ?? computeShadowProxyCoverage(terrainSummary.worldSize, config);
  // TODO: Replace finite-world summary coverage with streamed far-summary clipmap tiles.
  const { centerX, centerZ, extentM, buildRelative = false } = resolvedCoverage;
  const gridRes = config.gridRes;
  const n = gridRes + 1;
  const buildCenterX = buildRelative ? 0 : centerX;
  const buildCenterZ = buildRelative ? 0 : centerZ;
  const originX = buildCenterX - extentM;
  const originZ = buildCenterZ - extentM;
  const cellSize = (extentM * 2) / gridRes;

  const positions = new Float32Array(n * n * 3);
  const ringWeight = new Float32Array(n * n);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let cursor = 0;
  let buildMs = 0;
  let finished: ShadowProxyGeometryResult | null = null;

  const finalize = (): ShadowProxyGeometryResult => {
    if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
      return { geometry: null, stats: emptyStats(config), error: "all proxy heights invalid" };
    }

    const maxIndexCount = gridRes * gridRes * 6;
    const indices = new Uint32Array(maxIndexCount);
    let indexCount = 0;
    for (let gz = 0; gz < gridRes; gz++) {
      for (let gx = 0; gx < gridRes; gx++) {
        const a = gz * n + gx;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        const sampleX = buildRelative
          ? ((positions[a * 3] + positions[d * 3]) * 0.5 + centerX)
          : (positions[a * 3] + positions[d * 3]) * 0.5;
        const sampleZ = buildRelative
          ? ((positions[a * 3 + 2] + positions[d * 3 + 2]) * 0.5 + centerZ)
          : (positions[a * 3 + 2] + positions[d * 3 + 2]) * 0.5;
        const cellCenterDist = Math.hypot(sampleX - centerX, sampleZ - centerZ);
        if (cellCenterDist < config.startM) continue;
        const w = (ringWeight[a] + ringWeight[b] + ringWeight[c] + ringWeight[d]) * 0.25;
        if (w <= 0) continue;
        indices[indexCount++] = a;
        indices[indexCount++] = c;
        indices[indexCount++] = b;
        indices[indexCount++] = b;
        indices[indexCount++] = c;
        indices[indexCount++] = d;
      }
    }

    if (indexCount === 0) {
      return { geometry: null, stats: emptyStats(config), error: "no proxy triangles in coverage ring" };
    }

    const normals = new Float32Array(n * n * 3);
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const idx = gz * n + gx;
        const hxm = positions[(gz * n + Math.max(0, gx - 1)) * 3 + 1];
        const hxp = positions[(gz * n + Math.min(n - 1, gx + 1)) * 3 + 1];
        const hzm = positions[(Math.max(0, gz - 1) * n + gx) * 3 + 1];
        const hzp = positions[(Math.min(n - 1, gz + 1) * n + gx) * 3 + 1];
        const spanX = (gx === 0 || gx === n - 1) ? cellSize : cellSize * 2;
        const spanZ = (gz === 0 || gz === n - 1) ? cellSize : cellSize * 2;
        let nx = (hxm - hxp) / spanX;
        let ny = 1;
        let nz = (hzm - hzp) / spanZ;
        const len = Math.hypot(nx, ny, nz);
        if (Number.isFinite(len) && len > 0) {
          nx /= len;
          ny /= len;
          nz /= len;
        } else {
          nx = 0;
          ny = 1;
          nz = 0;
        }
        normals[idx * 3] = nx;
        normals[idx * 3 + 1] = ny;
        normals[idx * 3 + 2] = nz;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, indexCount), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const stats: ShadowProxyStats = {
      enabled: config.enabled,
      built: true,
      gridRes,
      vertexCount: n * n,
      triangleCount: indexCount / 3,
      buildMs,
      worldMinX: buildRelative ? centerX - extentM : originX,
      worldMaxX: buildRelative ? centerX + extentM : originX + extentM * 2,
      worldMinZ: buildRelative ? centerZ - extentM : originZ,
      worldMaxZ: buildRelative ? centerZ + extentM : originZ + extentM * 2,
      minHeight,
      maxHeight,
      castShadow: config.castShadow,
      receiveShadow: config.receiveShadow,
      mainPassColorWrite: config.mainPassColorWrite,
      mainPassDepthWrite: config.mainPassDepthWrite,
    };

    return { geometry, stats };
  };

  return {
    step(budgetMs: number): ShadowProxyGeometryResult | null {
      if (finished) return finished;
      const started = performance.now();
      const total = n * n;
      while (cursor < total) {
        const batchEnd = Math.min(total, cursor + BUDGET_CHECK_INTERVAL);
        for (; cursor < batchEnd; cursor++) {
          const gx = cursor % n;
          const gz = (cursor - gx) / n;
          const localX = originX + gx * cellSize;
          const localZ = originZ + gz * cellSize;
          const sampleX = buildRelative ? localX + centerX : localX;
          const sampleZ = buildRelative ? localZ + centerZ : localZ;
          const dist = Math.hypot(sampleX - centerX, sampleZ - centerZ);
          const y = sampleProxyHeight(terrainSummary, sampleX, sampleZ, config, dist);
          positions[cursor * 3] = localX;
          positions[cursor * 3 + 1] = y;
          positions[cursor * 3 + 2] = localZ;
          ringWeight[cursor] = ringFadeWeight(dist, config);
          if (Number.isFinite(y)) {
            minHeight = Math.min(minHeight, y);
            maxHeight = Math.max(maxHeight, y);
          }
        }
        if (cursor < total && performance.now() - started >= budgetMs) {
          buildMs += performance.now() - started;
          return null;
        }
      }
      finished = finalize();
      buildMs += performance.now() - started;
      finished.stats.buildMs = buildMs;
      return finished;
    },
  };
}

export function buildShadowProxyGeometry(
  terrainSummary: ShadowProxySource | null | undefined,
  config: ShadowProxyConfig,
  coverage?: ShadowProxyCoverage,
): ShadowProxyGeometryResult {
  const job = createShadowProxyGeometryJob(terrainSummary, config, coverage);
  const result = job.step(Number.POSITIVE_INFINITY);
  if (!result) throw new Error("shadow proxy geometry job did not complete with an unbounded budget");
  return result;
}
