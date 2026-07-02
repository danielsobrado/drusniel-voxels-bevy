import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  createForestLightingUniforms,
  injectForestLightingFragmentShader,
  injectForestLightingVertexShader,
  updateForestLightingUniforms,
  type ForestLightingMaterialState,
  type ForestLightingUniforms,
} from "../forest_lighting/index.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackedMeshBasicMaterial,
  trackedMeshStandardMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

export interface UnderstoryMaterialHandle {
  regularMaterial: THREE.Material;
  debugMaterials: Record<UnderstoryClass, THREE.Material>;
  setTime(timeSeconds: number): void;
  updateSettings(settings: UnderstorySettings): void;
  updateForestLighting(state: ForestLightingMaterialState | null): void;
  dispose(): void;
  prepassNodesFor?(cls: UnderstoryClass): PrepassNodes | undefined;
  updateLighting?(lighting: EnvironmentLighting): void;
}

interface UnderstoryWindUniforms {
  uUnderstoryTime: { value: number };
  uUnderstoryWindDirection: { value: THREE.Vector2 };
  uUnderstoryWindStrength: { value: number };
  uUnderstoryWindSpeed: { value: number };
}

const DEBUG_COLORS: Record<UnderstoryClass, number> = {
  shrub: 0x4f9a42,
  fern: 0x2f7a3d,
  sapling: 0x8abf5a,
  flower: 0xd66aa4,
  dead_log: 0x8a6140,
  stump: 0x6a4932,
};

export function createUnderstoryMaterialHandle(settings: UnderstorySettings): UnderstoryMaterialHandle {
  const uniforms = createUnderstoryWindUniforms();
  const forestUniforms = createForestLightingUniforms();
  updateUnderstoryWindUniforms(uniforms, settings);
  const regularMaterial = trackedMeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    alphaTest: settings.render.alphaTest,
  }, "understory-regular-material");
  attachUnderstoryShader(regularMaterial, uniforms, forestUniforms);

  const debugMaterials = {} as Record<UnderstoryClass, THREE.Material>;
  for (const cls of UNDERSTORY_CLASSES) {
    const material = trackedMeshBasicMaterial({
      color: DEBUG_COLORS[cls],
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      alphaTest: settings.render.alphaTest,
    }, `understory-debug-material:${cls}`);
    attachUnderstoryShader(material, uniforms, forestUniforms);
    debugMaterials[cls] = material;
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      uniforms.uUnderstoryTime.value = timeSeconds;
    },
    updateSettings(nextSettings: UnderstorySettings) {
      applyAlphaTest(regularMaterial, nextSettings.render.alphaTest, "understory-regular-alpha-test");
      for (const [cls, material] of Object.entries(debugMaterials)) {
        applyAlphaTest(material, nextSettings.render.alphaTest, `understory-debug-alpha-test:${cls}`);
      }
      updateUnderstoryWindUniforms(uniforms, nextSettings);
    },
    updateForestLighting(state) {
      updateForestLightingUniforms(forestUniforms, state, "understory");
    },
    dispose() {
      regularMaterial.dispose();
      for (const material of Object.values(debugMaterials)) material.dispose();
    },
  };
}

export function injectUnderstoryWindShader(vertexShader: string): string {
  return vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute float understoryWindWeight;
attribute float understoryWindPhase;
uniform float uUnderstoryTime;
uniform vec2 uUnderstoryWindDirection;
uniform float uUnderstoryWindStrength;
uniform float uUnderstoryWindSpeed;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
float understoryWave = sin(uUnderstoryTime * uUnderstoryWindSpeed + understoryWindPhase + position.y * 2.1);
float understoryBend = understoryWave * uUnderstoryWindStrength * understoryWindWeight;
transformed.xz += uUnderstoryWindDirection * understoryBend;`,
    );
}

function attachUnderstoryShader(
  material: THREE.Material,
  uniforms: UnderstoryWindUniforms,
  forestUniforms: ForestLightingUniforms,
): void {
  materialChurnDiagnostics.trackPipelineSensitiveMutation(material, "onBeforeCompile", null, "understory-shader", "understory-shader-attach");
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, forestUniforms);
    shader.vertexShader = injectForestLightingVertexShader(
      injectUnderstoryWindShader(shader.vertexShader),
      "understoryWorldXZ",
    );
    shader.fragmentShader = injectForestLightingFragmentShader(shader.fragmentShader);
  };
}

function applyAlphaTest(material: THREE.Material, alphaTest: number, reason: string): void {
  if (setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "alphaTest", alphaTest, reason)) {
    setMaterialNeedsUpdate(materialChurnDiagnostics, material, reason);
  }
}

function createUnderstoryWindUniforms(): UnderstoryWindUniforms {
  return {
    uUnderstoryTime: { value: 0 },
    uUnderstoryWindDirection: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uUnderstoryWindStrength: { value: 0.08 },
    uUnderstoryWindSpeed: { value: 1.15 },
  };
}

function updateUnderstoryWindUniforms(uniforms: UnderstoryWindUniforms, settings: UnderstorySettings): void {
  uniforms.uUnderstoryWindDirection.value.set(0.8, 0.6).normalize();
  uniforms.uUnderstoryWindStrength.value = settings.enabled ? 0.08 : 0;
  uniforms.uUnderstoryWindSpeed.value = 1.15;
}
