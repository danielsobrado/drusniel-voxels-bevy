import * as THREE from "three";
import type { ShadowProxyConfig, ShadowProxyCoverage, ShadowProxyRuntime, ShadowProxySource } from "./shadowProxyTypes.js";
import { buildShadowProxyGeometry } from "./shadowProxyGeometry.js";
import {
  applyShadowProxyMaterialFlags,
  createShadowProxyDepthMaterial,
  createShadowProxyMaterial,
} from "./shadowProxyMaterial.js";
import { createEmptyShadowProxyStats } from "./shadowProxyStats.js";

const PROXY_MESH_NAME = "DrusnielFarTerrainShadowProxy";

export function buildShadowProxyMesh(
  terrainSummary: ShadowProxySource | null | undefined,
  config: ShadowProxyConfig,
  coverage?: ShadowProxyCoverage,
): ShadowProxyRuntime {
  let mesh: THREE.Mesh | null = null;
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.MeshStandardMaterial | null = null;
  let depthMaterial: THREE.MeshDepthMaterial | null = null;
  let boundsHelper: THREE.Box3Helper | null = null;
  let stats = createEmptyShadowProxyStats();
  stats.enabled = config.enabled;

  if (!config.enabled) {
    return makeRuntime(null, stats, () => {});
  }

  const built = buildShadowProxyGeometry(terrainSummary, config, coverage);
  stats = built.stats;
  if (!built.geometry) {
    console.warn("[shadow-proxy] disabled:", built.error ?? "build failed");
    return makeRuntime(null, stats, () => {});
  }

  geometry = built.geometry;
  material = createShadowProxyMaterial(config);
  depthMaterial = createShadowProxyDepthMaterial(material);
  mesh = new THREE.Mesh(geometry, material);
  mesh.name = PROXY_MESH_NAME;
  mesh.frustumCulled = false;
  mesh.castShadow = config.castShadow;
  mesh.receiveShadow = config.receiveShadow;
  mesh.customDepthMaterial = depthMaterial;

  if (config.debugShowBounds && geometry.boundingBox) {
    boundsHelper = new THREE.Box3Helper(geometry.boundingBox.clone(), 0xffaa00);
    boundsHelper.name = "DrusnielFarTerrainShadowProxyBounds";
    mesh.add(boundsHelper);
  }

  return makeRuntime(mesh, stats, () => {
    if (boundsHelper) {
      boundsHelper.geometry.dispose();
      const helperMaterial = boundsHelper.material;
      if (Array.isArray(helperMaterial)) {
        for (const m of helperMaterial) m.dispose();
      } else {
        helperMaterial.dispose();
      }
    }
    geometry?.dispose();
    material?.dispose();
    depthMaterial?.dispose();
    mesh = null;
    geometry = null;
    material = null;
    depthMaterial = null;
    boundsHelper = null;
  });
}

function makeRuntime(
  mesh: THREE.Mesh | null,
  stats: import("./shadowProxyTypes.js").ShadowProxyStats,
  disposeImpl: () => void,
): ShadowProxyRuntime {
  let disposed = false;
  return {
    mesh,
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeImpl();
    },
  };
}

export function updateShadowProxyDebugMaterial(
  runtime: ShadowProxyRuntime,
  config: ShadowProxyConfig,
): void {
  if (!runtime.mesh) return;
  const material = runtime.mesh.material;
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  applyShadowProxyMaterialFlags(material, config);
  runtime.stats.mainPassColorWrite = config.debugVisibleProxy ? true : config.mainPassColorWrite;
  runtime.stats.mainPassDepthWrite = config.debugVisibleProxy ? false : config.mainPassDepthWrite;
}
