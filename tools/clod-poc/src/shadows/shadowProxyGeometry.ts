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

export function buildShadowProxyGeometry(
  terrainSummary: ShadowProxySource | null | undefined,
  config: ShadowProxyConfig,
  coverage?: ShadowProxyCoverage,
): ShadowProxyGeometryResult {
  const started = performance.now();
  const configCheck = validateShadowProxyConfig(config);
  if (!configCheck.ok) {
    return { geometry: null, stats: emptyStats(config), error: configCheck.reason };
  }
  const summaryCheck = validateTerrainSummarySource(terrainSummary);
  if (!summaryCheck.ok || !terrainSummary) {
    return { geometry: null, stats: emptyStats(config), error: summaryCheck.reason };
  }

  const resolvedCoverage = coverage ?? computeShadowProxyCoverage(terrainSummary.worldSize, config);
  // TODO: Replace finite-world summary coverage with streamed far-summary clipmap tiles.
  const { centerX, centerZ, extentM } = resolvedCoverage;
  const gridRes = config.gridRes;
  const n = gridRes + 1;
  const originX = centerX - extentM;
  const originZ = centerZ - extentM;
  const cellSize = (extentM * 2) / gridRes;

  const positions = new Float32Array(n * n * 3);
  const ringWeight = new Float32Array(n * n);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  const baseLevel = config.minHeightM;

  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = originX + gx * cellSize;
      const z = originZ + gz * cellSize;
      const dist = Math.hypot(x - centerX, z - centerZ);
      const y = sampleProxyHeight(terrainSummary, x, z, baseLevel, config, dist);
      const idx = gz * n + gx;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      ringWeight[idx] = ringFadeWeight(dist, config);
      if (Number.isFinite(y)) {
        minHeight = Math.min(minHeight, y);
        maxHeight = Math.max(maxHeight, y);
      }
    }
  }

  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    return { geometry: null, stats: emptyStats(config), error: "all proxy heights invalid" };
  }

  const indices: number[] = [];
  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const a = gz * n + gx;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      const cellCenterDist = Math.hypot(
        (positions[a * 3] + positions[d * 3]) * 0.5 - centerX,
        (positions[a * 3 + 2] + positions[d * 3 + 2]) * 0.5 - centerZ,
      );
      if (cellCenterDist < config.startM) continue;
      const w = (ringWeight[a] + ringWeight[b] + ringWeight[c] + ringWeight[d]) * 0.25;
      if (w <= 0) continue;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (indices.length === 0) {
    return { geometry: null, stats: emptyStats(config), error: "no proxy triangles in coverage ring" };
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const buildMs = performance.now() - started;
  const stats: ShadowProxyStats = {
    enabled: config.enabled,
    built: true,
    gridRes,
    vertexCount: n * n,
    triangleCount: indices.length / 3,
    buildMs,
    worldMinX: originX,
    worldMaxX: originX + extentM * 2,
    worldMinZ: originZ,
    worldMaxZ: originZ + extentM * 2,
    minHeight,
    maxHeight,
    castShadow: config.castShadow,
    receiveShadow: config.receiveShadow,
    mainPassColorWrite: config.mainPassColorWrite,
    mainPassDepthWrite: config.mainPassDepthWrite,
  };

  return { geometry, stats };
}
