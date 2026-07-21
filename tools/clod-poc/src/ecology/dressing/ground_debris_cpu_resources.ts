import * as THREE from "three";
import type { DressingClassId } from "./class_registry.js";
import { createGroundDebrisGeometry } from "./gpu/ground_debris_geometry.js";
import {
  GROUND_DEBRIS_CLASSES,
  groundDebrisVisualProfile,
  type GroundDebrisVisualProfile,
} from "./gpu/ground_debris_visuals.js";

const CPU_FADE_SHADER_REVISION = 1;
const CPU_FADE_WORLD_CELL_SCALE = 2;

export interface GroundDebrisCpuMaterialState {
  readonly color: number;
  readonly roughness: number;
}

export interface GroundDebrisCpuFadeShaders {
  readonly vertexShader: string;
  readonly fragmentShader: string;
}

export class GroundDebrisCpuResources {
  private readonly geometries = new Map<DressingClassId, THREE.BufferGeometry>();
  private readonly materials = new Map<DressingClassId, THREE.MeshStandardMaterial>();
  private disposed = false;

  constructor() {
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const geometry = createGroundDebrisGeometry(classId, 0);
      if (!geometry) throw new Error(`missing CPU ground-debris geometry: ${classId}`);
      this.geometries.set(classId, geometry);
      this.materials.set(classId, createGroundDebrisCpuMaterial(classId));
    }
  }

  apply(scene: THREE.Scene): number {
    if (this.disposed) return 0;
    const root = scene.getObjectByName("ecological-dressing");
    if (!root) return 0;

    let applied = 0;
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const object = root.getObjectByName(`dressing:${classId}`);
      if (!(object instanceof THREE.InstancedMesh)) continue;
      const geometry = this.geometries.get(classId);
      const material = this.materials.get(classId);
      if (!geometry || !material) continue;
      object.geometry = geometry;
      object.material = material;
      object.castShadow = false;
      object.receiveShadow = true;
      applied += 1;
    }
    return applied;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

export function groundDebrisCpuMaterialState(classId: DressingClassId): GroundDebrisCpuMaterialState | null {
  const profile = groundDebrisVisualProfile(classId);
  if (!profile) return null;
  const alwaysWet = classId === "wet_stone_cluster";
  return {
    color: alwaysWet ? profile.wetColor : profile.baseColor,
    roughness: alwaysWet ? profile.wetRoughness : profile.dryRoughness,
  };
}

export function injectGroundDebrisCpuFadeShaders(
  vertexShader: string,
  fragmentShader: string,
  profile: GroundDebrisVisualProfile,
): GroundDebrisCpuFadeShaders {
  const vertexCommon = "#include <common>";
  const vertexWorld = "#include <worldpos_vertex>";
  const fragmentCommon = "#include <common>";
  const fragmentFade = "#include <dithering_fragment>";
  if (!vertexShader.includes(vertexCommon) || !vertexShader.includes(vertexWorld)) {
    throw new Error("CPU ground-debris fade requires Three world-position vertex chunks");
  }
  if (!fragmentShader.includes(fragmentCommon) || !fragmentShader.includes(fragmentFade)) {
    throw new Error("CPU ground-debris fade requires Three common and dithering fragment chunks");
  }

  const fadeStart = shaderNumber(profile.fadeStartM);
  const fadeEnd = shaderNumber(profile.fadeEndM);
  const vertex = vertexShader
    .replace(vertexCommon, `${vertexCommon}\nvarying vec3 vGroundDebrisWorldPosition;`)
    .replace(vertexWorld, `${vertexWorld}\n  vGroundDebrisWorldPosition = worldPosition.xyz;`);
  const fragment = fragmentShader
    .replace(
      fragmentCommon,
      `${fragmentCommon}\nvarying vec3 vGroundDebrisWorldPosition;\nfloat groundDebrisStableHash(vec2 cell) {\n  return fract(sin(dot(cell, vec2(41.3, 289.1))) * 43758.5453);\n}`,
    )
    .replace(
      fragmentFade,
      `float groundDebrisDistanceM = distance(cameraPosition.xz, vGroundDebrisWorldPosition.xz);\nfloat groundDebrisVisibility = clamp((${fadeEnd} - groundDebrisDistanceM) / max(0.001, ${fadeEnd} - ${fadeStart}), 0.0, 1.0);\nfloat groundDebrisDither = groundDebrisStableHash(floor(vGroundDebrisWorldPosition.xz * ${shaderNumber(CPU_FADE_WORLD_CELL_SCALE)}));\nif (groundDebrisDither >= groundDebrisVisibility) discard;\n${fragmentFade}`,
    );
  return { vertexShader: vertex, fragmentShader: fragment };
}

function createGroundDebrisCpuMaterial(classId: DressingClassId): THREE.MeshStandardMaterial {
  const profile = groundDebrisVisualProfile(classId);
  const state = groundDebrisCpuMaterialState(classId);
  if (!profile || !state) throw new Error(`missing CPU ground-debris material profile: ${classId}`);
  const material = new THREE.MeshStandardMaterial({
    color: state.color,
    roughness: state.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0,
    depthWrite: true,
  });
  material.name = `ground-debris-cpu-${classId}`;
  installGroundDebrisCpuFade(material, profile);
  return material;
}

function installGroundDebrisCpuFade(
  material: THREE.MeshStandardMaterial,
  profile: GroundDebrisVisualProfile,
): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    const injected = injectGroundDebrisCpuFadeShaders(
      shader.vertexShader,
      shader.fragmentShader,
      profile,
    );
    shader.vertexShader = injected.vertexShader;
    shader.fragmentShader = injected.fragmentShader;
  };
  material.customProgramCacheKey = () => [
    previousCacheKey(),
    "ground-debris-cpu-fade",
    CPU_FADE_SHADER_REVISION,
    profile.fadeStartM,
    profile.fadeEndM,
  ].join("|");
  material.userData.groundDebrisCpuFade = Object.freeze({
    revision: CPU_FADE_SHADER_REVISION,
    fadeStartM: profile.fadeStartM,
    fadeEndM: profile.fadeEndM,
  });
  material.needsUpdate = true;
}

function shaderNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}
