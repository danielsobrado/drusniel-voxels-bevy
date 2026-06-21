import * as THREE from "three";
import { TREE_LODS, type TreeLod, type TreeSettings } from "./tree_config.js";

export interface TreeMaterialHandle {
  regularMaterial: THREE.MeshStandardMaterial;
  debugMaterials: Record<TreeLod, THREE.MeshBasicMaterial>;
  setTime(timeSeconds: number): void;
  updateSettings(settings: TreeSettings): void;
  dispose(): void;
}

const LOD_COLORS: Record<TreeLod, number> = {
  near: 0x2e7d32,
  mid: 0xd98032,
  far: 0x3a6ea5,
};

interface TreeWindUniforms {
  uTreeTime: { value: number };
  uTreeWindDirection: { value: THREE.Vector2 };
  uTreeWindStrength: { value: number };
  uTreeWindSpeed: { value: number };
  uTreeGustStrength: { value: number };
  uTreeTrunkSwayStrength: { value: number };
  uTreeLeafFlutterStrength: { value: number };
}

export function createTreeMaterialHandle(settings: TreeSettings): TreeMaterialHandle {
  const uniforms = createTreeWindUniforms(settings);
  const regularMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
  });
  attachTreeWindShader(regularMaterial, uniforms);

  const debugMaterials = {} as Record<TreeLod, THREE.MeshBasicMaterial>;
  for (const lod of TREE_LODS) {
    const material = new THREE.MeshBasicMaterial({
      color: LOD_COLORS[lod],
      side: THREE.DoubleSide,
      transparent: false,
    });
    attachTreeWindShader(material, uniforms);
    debugMaterials[lod] = material;
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      uniforms.uTreeTime.value = timeSeconds;
    },
    updateSettings(nextSettings: TreeSettings) {
      updateTreeWindUniforms(uniforms, nextSettings);
    },
    dispose() {
      regularMaterial.dispose();
      for (const material of Object.values(debugMaterials)) material.dispose();
    },
  };
}

export function injectTreeWindShader(vertexShader: string): string {
  return vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute float treeWindWeight;
attribute float treeFlutterWeight;
uniform float uTreeTime;
uniform vec2 uTreeWindDirection;
uniform float uTreeWindStrength;
uniform float uTreeWindSpeed;
uniform float uTreeGustStrength;
uniform float uTreeTrunkSwayStrength;
uniform float uTreeLeafFlutterStrength;

float treeWindHash(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
#ifdef USE_INSTANCING
vec2 treeInstanceWorldXZ = instanceMatrix[3].xz;
#else
vec2 treeInstanceWorldXZ = vec2(0.0);
#endif
float treePhase = treeWindHash(treeInstanceWorldXZ);
float treeTime = uTreeTime * uTreeWindSpeed;
float treeWave = sin(treeTime + treePhase * 6.2831853 + dot(treeInstanceWorldXZ, uTreeWindDirection) * 0.035);
float treeGust = sin(treeTime * 0.37 + treePhase * 12.9898) * uTreeGustStrength;
float treeSway = (treeWave * uTreeWindStrength + treeGust) * treeWindWeight * uTreeTrunkSwayStrength;
float treeFlutter = sin(treeTime * 7.0 + treePhase * 19.19 + position.y * 2.3) *
  uTreeWindStrength * uTreeLeafFlutterStrength * treeFlutterWeight;
transformed.xz += uTreeWindDirection * (treeSway + treeFlutter);`,
    );
}

function attachTreeWindShader(material: THREE.Material, uniforms: TreeWindUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectTreeWindShader(shader.vertexShader);
  };
}

function createTreeWindUniforms(settings: TreeSettings): TreeWindUniforms {
  const uniforms: TreeWindUniforms = {
    uTreeTime: { value: 0 },
    uTreeWindDirection: { value: new THREE.Vector2(1, 0) },
    uTreeWindStrength: { value: 0 },
    uTreeWindSpeed: { value: 0 },
    uTreeGustStrength: { value: 0 },
    uTreeTrunkSwayStrength: { value: 0 },
    uTreeLeafFlutterStrength: { value: 0 },
  };
  updateTreeWindUniforms(uniforms, settings);
  return uniforms;
}

function updateTreeWindUniforms(uniforms: TreeWindUniforms, settings: TreeSettings): void {
  const wind = settings.wind;
  uniforms.uTreeWindDirection.value.set(wind.direction[0], wind.direction[1]);
  if (uniforms.uTreeWindDirection.value.lengthSq() <= 1e-8) uniforms.uTreeWindDirection.value.set(1, 0);
  else uniforms.uTreeWindDirection.value.normalize();

  const enabled = wind.enabled ? 1 : 0;
  uniforms.uTreeWindStrength.value = wind.strength * enabled;
  uniforms.uTreeWindSpeed.value = wind.speed;
  uniforms.uTreeGustStrength.value = wind.gustStrength * enabled;
  uniforms.uTreeTrunkSwayStrength.value = wind.trunkSwayStrength * enabled;
  uniforms.uTreeLeafFlutterStrength.value = wind.leafFlutterStrength * enabled;
}
