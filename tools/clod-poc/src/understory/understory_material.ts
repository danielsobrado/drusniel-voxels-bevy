import * as THREE from "three";
import type { EnvironmentLighting } from "../environment.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  createForestLightingUniforms,
  injectForestLightingFragmentShader,
  injectForestLightingVertexShader,
  updateForestLightingUniforms,
  type ForestLightingMaterialState,
  type ForestLightingUniforms,
} from "../forest_lighting/index.js";

export interface UnderstoryMaterialHandle {
  regularMaterial: THREE.Material;
  debugMaterials: Record<UnderstoryClass, THREE.Material>;
  setTime(timeSeconds: number): void;
  updateSettings(settings: UnderstorySettings): void;
  updateForestLighting(state: ForestLightingMaterialState | null): void;
  dispose(): void;
  /** WebGPU node path only; the classic WebGL path lights via scene lights. */
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
  const regularMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    alphaTest: settings.render.alphaTest,
  });
  attachUnderstoryShader(regularMaterial, uniforms, forestUniforms);

  const debugMaterials = {} as Record<UnderstoryClass, THREE.Material>;
  for (const cls of UNDERSTORY_CLASSES) {
    const material = new THREE.MeshBasicMaterial({
      color: DEBUG_COLORS[cls],
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      alphaTest: settings.render.alphaTest,
    });
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
      regularMaterial.alphaTest = nextSettings.render.alphaTest;
      regularMaterial.needsUpdate = true;
      for (const material of Object.values(debugMaterials)) {
        material.alphaTest = nextSettings.render.alphaTest;
        material.needsUpdate = true;
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
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, forestUniforms);
    shader.vertexShader = injectForestLightingVertexShader(
      injectUnderstoryWindShader(shader.vertexShader),
      "understoryWorldXZ",
    );
    shader.fragmentShader = injectForestLightingFragmentShader(shader.fragmentShader);
  };
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
