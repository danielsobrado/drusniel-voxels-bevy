import * as THREE from "three";
import type { ShadowProxyConfig } from "./shadowProxyTypes.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackedMeshDepthMaterial,
  trackedMeshStandardMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

function resolveShadowSide(side: ShadowProxyConfig["shadowSide"]): THREE.Side {
  if (side === "front") return THREE.FrontSide;
  if (side === "back") return THREE.BackSide;
  return THREE.DoubleSide;
}

export function createShadowProxyMaterial(config: ShadowProxyConfig): THREE.MeshStandardMaterial {
  const debugVisible = config.debugVisibleProxy;
  const material = trackedMeshStandardMaterial({
    color: debugVisible ? 0x44ff88 : 0xffffff,
    transparent: debugVisible,
    opacity: debugVisible ? 0.35 : 1,
    wireframe: config.debugWireframe,
    side: resolveShadowSide(config.shadowSide),
    roughness: 1,
    metalness: 0,
    colorWrite: debugVisible ? true : config.mainPassColorWrite,
    depthWrite: debugVisible ? false : config.mainPassDepthWrite,
    depthTest: !debugVisible,
  }, debugVisible ? "shadow-proxy-debug-material" : "shadow-proxy-material");
  material.name = debugVisible ? "DrusnielFarTerrainShadowProxyDebug" : "DrusnielFarTerrainShadowProxy";
  return material;
}

export function applyShadowProxyMaterialFlags(
  material: THREE.MeshStandardMaterial,
  config: ShadowProxyConfig,
): void {
  const debugVisible = config.debugVisibleProxy;
  let changed = false;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "wireframe", config.debugWireframe, "shadow-proxy-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", resolveShadowSide(config.shadowSide), "shadow-proxy-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "transparent", debugVisible, "shadow-proxy-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "colorWrite", debugVisible ? true : config.mainPassColorWrite, "shadow-proxy-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", debugVisible ? false : config.mainPassDepthWrite, "shadow-proxy-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthTest", !debugVisible, "shadow-proxy-flags") || changed;
  material.opacity = debugVisible ? 0.35 : 1;
  material.color.setHex(debugVisible ? 0x44ff88 : 0xffffff);
  if (changed) setMaterialNeedsUpdate(materialChurnDiagnostics, material, "shadow-proxy-flags");
}

export function createShadowProxyDepthMaterial(
  source: THREE.MeshStandardMaterial,
): THREE.MeshDepthMaterial {
  const depth = trackedMeshDepthMaterial({
    side: source.side,
  }, "shadow-proxy-depth-material");
  depth.name = "DrusnielFarTerrainShadowProxyDepth";
  return depth;
}
