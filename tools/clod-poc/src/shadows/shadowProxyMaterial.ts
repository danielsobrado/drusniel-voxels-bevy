import * as THREE from "three";
import type { ShadowProxyConfig } from "./shadowProxyTypes.js";

function resolveShadowSide(side: ShadowProxyConfig["shadowSide"]): THREE.Side {
  if (side === "front") return THREE.FrontSide;
  if (side === "back") return THREE.BackSide;
  return THREE.DoubleSide;
}

export function createShadowProxyMaterial(config: ShadowProxyConfig): THREE.MeshStandardMaterial {
  const debugVisible = config.debugVisibleProxy;
  const material = new THREE.MeshStandardMaterial({
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
  });
  material.name = debugVisible ? "DrusnielFarTerrainShadowProxyDebug" : "DrusnielFarTerrainShadowProxy";
  return material;
}

export function applyShadowProxyMaterialFlags(
  material: THREE.MeshStandardMaterial,
  config: ShadowProxyConfig,
): void {
  const debugVisible = config.debugVisibleProxy;
  material.wireframe = config.debugWireframe;
  material.side = resolveShadowSide(config.shadowSide);
  material.transparent = debugVisible;
  material.opacity = debugVisible ? 0.35 : 1;
  material.colorWrite = debugVisible ? true : config.mainPassColorWrite;
  material.depthWrite = debugVisible ? false : config.mainPassDepthWrite;
  material.depthTest = !debugVisible;
  material.color.setHex(debugVisible ? 0x44ff88 : 0xffffff);
  material.needsUpdate = true;
}

export function createShadowProxyDepthMaterial(
  source: THREE.MeshStandardMaterial,
): THREE.MeshDepthMaterial {
  const depth = new THREE.MeshDepthMaterial({
    side: source.side,
  });
  depth.name = "DrusnielFarTerrainShadowProxyDepth";
  return depth;
}
