// WebGPU understory material (docs/webgpu-migration.md). TSL port of the classic
// MeshStandardMaterial + onBeforeCompile path in understory_material.ts. As with trees,
// WebGPURenderer silently drops `onBeforeCompile`, so the classic path renders the
// understory as solid black. This reauthors the same look as a node graph: lit vertex
// colours + the understory sway wind. Forest-lighting AO/fog stays on the classic path
// for now (node integration deferred), matching the tree ring material.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  cos,
  dot,
  float,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
  normalWorld,
  normalize,
  positionGeometry,
  sin,
  storage,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import type { UnderstoryMaterialHandle } from "./understory_material.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

const DEBUG_COLORS: Record<UnderstoryClass, THREE.Color> = {
  shrub: new THREE.Color(0x4f9a42),
  fern: new THREE.Color(0x2f7a3d),
  sapling: new THREE.Color(0x8abf5a),
  flower: new THREE.Color(0xd66aa4),
  dead_log: new THREE.Color(0x8a6140),
  stump: new THREE.Color(0x6a4932),
};

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1.0, 0.96, 0.88),
    skyLight: new THREE.Color(0x6b7a94),
    groundLight: new THREE.Color(0x2e2921),
  };
}

export function createUnderstoryNodeMaterialHandle(
  settings: UnderstorySettings,
  lighting: EnvironmentLighting = fallbackLighting(),
): UnderstoryMaterialHandle {
  const uTime = uniform(0);
  const windDir = new THREE.Vector2(0.8, 0.6).normalize();
  const uWindDirX = uniform(windDir.x) as TslNode;
  const uWindDirZ = uniform(windDir.y) as TslNode;
  const uWindStrength = uniform(settings.enabled ? 0.08 : 0);
  const uWindSpeed = uniform(1.15);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];

  const buildMaterial = (albedoFactory: (vertexColor: TslNode) => TslNode): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aWindWeight: TslNode = attribute("understoryWindWeight", "float");
    const aWindPhase: TslNode = attribute("understoryWindPhase", "float");

    // Sway, matching injectUnderstoryWindShader(): object-space XZ bend before the
    // instance matrix, exactly like the classic <begin_vertex> injection.
    const wave: TslNode = sin(uTime.mul(uWindSpeed).add(aWindPhase).add(positionGeometry.y.mul(2.1)));
    const bend: TslNode = wave.mul(uWindStrength).mul(aWindWeight);
    const bendOffset: TslNode = vec3(uWindDirX, float(0), uWindDirZ).mul(bend);
    const positionNode: TslNode = positionGeometry.add(bendOffset);

    const n0: TslNode = normalize(normalWorld);
    const n: TslNode = frontFacing.select(n0, n0.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const albedo: TslNode = albedoFactory(aColor);
    const lit: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(uSun.mul(sun))));

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor) => vertexColor);
  const debugMaterials = {} as Record<UnderstoryClass, THREE.Material>;
  for (const cls of UNDERSTORY_CLASSES) {
    const color = DEBUG_COLORS[cls];
    debugMaterials[cls] = buildMaterial(() => vec3(color.r, color.g, color.b));
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      uTime.value = timeSeconds;
    },
    updateSettings(next: UnderstorySettings) {
      uWindStrength.value = next.enabled ? 0.08 : 0;
    },
    updateForestLighting() {
      // Node path: forest AO/fog integration deferred (mirrors the tree ring material).
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}

export interface UnderstoryRingInstanceBuffers {
  cell: THREE.BufferAttribute;
  capacity: number;
}

export function createUnderstoryRingNodeMaterialHandle(
  settings: UnderstorySettings,
  buffers: UnderstoryRingInstanceBuffers,
  lighting: EnvironmentLighting = fallbackLighting(),
  classMinScale?: number,
  classMaxScale?: number,
): UnderstoryMaterialHandle {
  const uTime = uniform(0);
  const windDir = new THREE.Vector2(0.8, 0.6).normalize();
  const uWindDirX = uniform(windDir.x) as TslNode;
  const uWindDirZ = uniform(windDir.y) as TslNode;
  const uWindStrength = uniform(settings.enabled ? 0.08 : 0);
  const uWindSpeed = uniform(1.15);
  const uCellSize = uniform(settings.placement.spacingM);
  const uSeed = uniform(settings.seed);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];

  const buildMaterial = (albedoFactory: (vertexColor: TslNode) => TslNode): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aWindWeight: TslNode = attribute("understoryWindWeight", "float");

    const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
    const aCell: TslNode = cellStore.element(instanceIndex);
    const worldCell: TslNode = aCell.xy;
    const jitter: TslNode = vec2(understoryRingHash(worldCell, uSeed, 1103), understoryRingHash(worldCell, uSeed, 1200));
    const aWorldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
    const aHeight: TslNode = aCell.z;

    const minS = classMinScale ?? 0.5;
    const maxS = classMaxScale ?? 1.25;
    const aScale: TslNode = understoryRingHash(worldCell, uSeed, 601).mul(maxS - minS).add(minS);
    const aYaw: TslNode = understoryRingHash(worldCell, uSeed, 701).mul(6.28318530718);
    const aWindPhase: TslNode = understoryRingHash(worldCell, uSeed, 809).mul(6.28318530718);

    // Sway, matching injectUnderstoryWindShader(): object-space XZ bend.
    const wave: TslNode = sin(uTime.mul(uWindSpeed).add(aWindPhase).add(positionGeometry.y.mul(2.1)));
    const bend: TslNode = wave.mul(uWindStrength).mul(aWindWeight);
    const bendOffset: TslNode = vec3(uWindDirX, float(0), uWindDirZ).mul(bend);
    const localPosition: TslNode = positionGeometry.mul(aScale).add(bendOffset);

    // Rotate around Y axis by aYaw, then translate to world position.
    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(aWorldXZ.x.add(rotX), aHeight.add(localPosition.y), aWorldXZ.y.add(rotZ));

    const n0: TslNode = normalize(normalWorld);
    const n: TslNode = frontFacing.select(n0, n0.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const albedo: TslNode = albedoFactory(aColor);
    const lit: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(uSun.mul(sun))));

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor) => vertexColor);
  const debugMaterials = {} as Record<UnderstoryClass, THREE.Material>;
  for (const cls of UNDERSTORY_CLASSES) {
    const color = DEBUG_COLORS[cls];
    debugMaterials[cls] = buildMaterial(() => vec3(color.r, color.g, color.b));
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      uTime.value = timeSeconds;
    },
    updateSettings(next: UnderstorySettings) {
      uWindStrength.value = next.enabled ? 0.08 : 0;
      uCellSize.value = next.placement.spacingM;
      uSeed.value = next.seed;
    },
    updateForestLighting() {
      // Node path: forest AO/fog integration deferred (mirrors the tree ring material).
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}

function understoryRingHash(cell: TslNode, seed: TslNode, saltValue: number): TslNode {
  const salt = float(saltValue);
  return fract(
    sin(dot(cell.add(vec2(seed.add(salt), seed.mul(0.37).add(salt.mul(1.17)))), vec2(41.3, 289.1))).mul(43758.5453),
  );
}
