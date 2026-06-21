import * as THREE from "three";
import type { ForestLightingDebugMode, ForestLightingSettings } from "./forest_lighting_config.js";
import type { ForestLightingTextureHandle } from "./forest_lighting_texture.js";

export interface ForestLightingMaterialState {
  textureHandle: ForestLightingTextureHandle;
  settings: ForestLightingSettings;
  worldCells: number;
}

export interface ForestLightingMaterialUpdateSignature {
  textureHandle: ForestLightingTextureHandle;
  textureUpdates: number;
  settingsVersion: number;
  enabled: boolean;
  debugMode: ForestLightingDebugMode;
}

export interface ForestLightingMaterialUpdateTarget {
  updateForestLighting(state: ForestLightingMaterialState): void;
}

export interface ForestLightingUniforms {
  uForestLightingMap: { value: THREE.Texture | null };
  uForestLightingAuxMap: { value: THREE.Texture | null };
  uForestLightingEnabled: { value: number };
  uForestLightingWorldSize: { value: number };
  uForestAoStrength: { value: number };
  uForestShadowStrength: { value: number };
  uForestFogStrength: { value: number };
  uForestFogColor: { value: THREE.Color };
  uForestDebugMode: { value: number };
}

export function forestLightingMaterialSignatureChanged(
  previous: ForestLightingMaterialUpdateSignature | null,
  next: ForestLightingMaterialUpdateSignature,
): boolean {
  return !previous ||
    previous.textureHandle !== next.textureHandle ||
    previous.textureUpdates !== next.textureUpdates ||
    previous.settingsVersion !== next.settingsVersion ||
    previous.enabled !== next.enabled ||
    previous.debugMode !== next.debugMode;
}

export function applyForestLightingMaterialStateIfChanged(
  previous: ForestLightingMaterialUpdateSignature | null,
  next: ForestLightingMaterialUpdateSignature,
  state: ForestLightingMaterialState,
  targets: readonly ForestLightingMaterialUpdateTarget[],
): ForestLightingMaterialUpdateSignature {
  if (!forestLightingMaterialSignatureChanged(previous, next)) return previous ?? next;
  for (const target of targets) target.updateForestLighting(state);
  return next;
}

export function createForestLightingUniforms(): ForestLightingUniforms {
  return {
    uForestLightingMap: { value: null },
    uForestLightingAuxMap: { value: null },
    uForestLightingEnabled: { value: 0 },
    uForestLightingWorldSize: { value: 1 },
    uForestAoStrength: { value: 1 },
    uForestShadowStrength: { value: 1 },
    uForestFogStrength: { value: 1 },
    uForestFogColor: { value: new THREE.Color(0xb9c8cf) },
    uForestDebugMode: { value: 0 },
  };
}

export function updateForestLightingUniforms(
  uniforms: ForestLightingUniforms,
  state: ForestLightingMaterialState | null,
  target: "tree" | "understory",
): void {
  if (!state) {
    uniforms.uForestLightingEnabled.value = 0;
    return;
  }
  const settings = state.settings;
  const materialEnabled = target === "tree"
    ? settings.materialIntegration.treeEnabled
    : settings.materialIntegration.understoryEnabled;
  uniforms.uForestLightingMap.value = state.textureHandle.texture;
  uniforms.uForestLightingAuxMap.value = state.textureHandle.auxTexture;
  uniforms.uForestLightingEnabled.value = settings.enabled && materialEnabled ? 1 : 0;
  uniforms.uForestLightingWorldSize.value = Math.max(1, state.worldCells);
  uniforms.uForestAoStrength.value = settings.ambientOcclusion.strength;
  uniforms.uForestShadowStrength.value = settings.shadowProxy.strength;
  uniforms.uForestFogStrength.value = settings.atmosphere.forestFogStrength + settings.atmosphere.aerialTintStrength;
  uniforms.uForestDebugMode.value = forestLightingDebugModeValue(settings.materialIntegration.debugMode);
}

export function injectForestLightingVertexShader(
  vertexShader: string,
  attributeName: string,
  declareAttribute = true,
): string {
  const attributeDeclaration = declareAttribute ? `attribute vec2 ${attributeName};\n` : "";
  return vertexShader
    .replace(
      "#include <common>",
      `#include <common>
${attributeDeclaration}
varying vec2 vForestWorldXZ;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vForestWorldXZ = ${attributeName};`,
    );
}

export function injectForestLightingFragmentShader(fragmentShader: string): string {
  return fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
varying vec2 vForestWorldXZ;
uniform sampler2D uForestLightingMap;
uniform sampler2D uForestLightingAuxMap;
uniform float uForestLightingEnabled;
uniform float uForestLightingWorldSize;
uniform float uForestAoStrength;
uniform float uForestShadowStrength;
uniform float uForestFogStrength;
uniform vec3 uForestFogColor;
uniform float uForestDebugMode;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
if (uForestLightingEnabled > 0.5) {
  vec2 forestUv = clamp(vForestWorldXZ / max(uForestLightingWorldSize, 0.0001), vec2(0.0), vec2(1.0));
  vec4 forestPacked = texture2D(uForestLightingMap, forestUv);
  vec4 forestAux = texture2D(uForestLightingAuxMap, forestUv);
  float forestCanopy = forestAux.r;
  float forestEdge = forestAux.g;
  float forestAo = forestPacked.r;
  float forestShadow = forestPacked.g;
  float forestFog = forestPacked.b;
  float forestShaft = forestPacked.a;
  if (uForestDebugMode > 0.5) {
    if (uForestDebugMode < 1.5) diffuseColor.rgb = vec3(forestCanopy);
    else if (uForestDebugMode < 2.5) diffuseColor.rgb = vec3(forestAo);
    else if (uForestDebugMode < 3.5) diffuseColor.rgb = vec3(forestShadow);
    else if (uForestDebugMode < 4.5) diffuseColor.rgb = vec3(forestFog);
    else if (uForestDebugMode < 5.5) diffuseColor.rgb = vec3(forestShaft);
    else diffuseColor.rgb = vec3(forestAo, forestShadow, max(forestFog, forestEdge));
  } else {
    float forestDarken = clamp(forestAo * uForestAoStrength + forestShadow * uForestShadowStrength, 0.0, 0.72);
    diffuseColor.rgb *= 1.0 - forestDarken;
    diffuseColor.rgb = mix(diffuseColor.rgb, uForestFogColor, clamp(forestFog * uForestFogStrength, 0.0, 0.35));
    diffuseColor.rgb += vec3(forestShaft * 0.05);
  }
}`,
    );
}

export function forestLightingDebugModeValue(mode: ForestLightingDebugMode): number {
  switch (mode) {
    case "canopy": return 1;
    case "ao": return 2;
    case "shadow": return 3;
    case "fog": return 4;
    case "sun_shafts": return 5;
    case "combined": return 6;
    default: return 0;
  }
}
