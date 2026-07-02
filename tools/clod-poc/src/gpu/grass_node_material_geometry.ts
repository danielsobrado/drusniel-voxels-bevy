import * as THREE from "three";
import {
  createBladeGeometry,
  createGrassClumpGeometry,
  createGrassTuftGeometry,
  DEFAULT_GRASS_SETTINGS,
  grassRowsForSegments,
  type GrassBladeInstance,
  type GrassTier,
} from "../grass.js";
import type { GrassInstancedGeometryOptions } from "./grass_node_material_types.js";

function tierIndex(tier: GrassTier | undefined): number {
  if (tier === "mid") return 1;
  if (tier === "far") return 2;
  if (tier === "super") return 3;
  return 0;
}

export function grassMidInstances(instances: readonly GrassBladeInstance[]): GrassBladeInstance[] {
  const midCount = Math.max(1, Math.floor(instances.length * DEFAULT_GRASS_SETTINGS.lod.midInstanceFraction));
  return instances.slice(0, midCount).map((instance) => ({
    ...instance,
    height: instance.height * 1.55,
    edgeFade: Math.min(1, instance.edgeFade * 1.15),
  }));
}

export function buildGrassInstancedGeometry(
  instances: readonly GrassBladeInstance[],
  options: GrassInstancedGeometryOptions = {},
): THREE.InstancedBufferGeometry {
  const mode = options.mode ?? "classic";
  const terrainPatchMode = mode === "terrain-patch-v2" || mode === "webgpu-ring-v1";
  const settings = options.settings ?? DEFAULT_GRASS_SETTINGS;
  const nearRows = grassRowsForSegments(settings.blade.nearSegments);
  const midRows = grassRowsForSegments(settings.blade.midSegments, 0);
  const rows = terrainPatchMode && options.tier === "mid" ? midRows : terrainPatchMode ? nearRows : undefined;
  let base: THREE.BufferGeometry;
  if (mode === "webgpu-ring-v1" && options.tier === "near") {
    base = createGrassClumpGeometry(settings.blade.nearBladesPerInstance, settings.blade.nearSegments, settings);
  } else if (mode === "webgpu-ring-v1" && options.tier === "mid") {
    base = createGrassClumpGeometry(settings.blade.midBladesPerInstance, settings.blade.midSegments, settings);
  } else if (terrainPatchMode && options.tier === "far") {
    base = createGrassTuftGeometry(settings);
  } else if (terrainPatchMode && options.tier === "super") {
    base = createGrassTuftGeometry(settings.blade.farTuftWidthM * 1.45 / Math.max(settings.blade.widthM, 0.001));
  } else {
    base = rows ? createBladeGeometry(rows, options.crossed === true && options.tier !== "mid") : createBladeGeometry();
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setAttribute("normal", base.getAttribute("normal"));

  const count = instances.length;
  const offset = new Float32Array(count * 4);
  const packed0 = new Float32Array(count * 4);
  const packed1 = new Float32Array(count * 4);
  const terrainNormal = new Float32Array(count * 4);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  instances.forEach((b, i) => {
    offset[i * 4] = b.offset[0];
    offset[i * 4 + 1] = b.offset[1];
    offset[i * 4 + 2] = b.offset[2];
    offset[i * 4 + 3] = 1;
    const edgeMultiplier = options.edgeShape === true && terrainPatchMode
      ? THREE.MathUtils.lerp(0.35, 1.0, THREE.MathUtils.clamp(b.edgeFade, 0, 1))
      : 1;
    const height = b.height * edgeMultiplier;
    packed0[i * 4] = height;
    packed0[i * 4 + 1] = b.rotationY;
    packed0[i * 4 + 2] = b.phase;
    packed0[i * 4 + 3] = b.colorMix;
    packed1[i * 4] = b.edgeFade;
    packed1[i * 4 + 1] = b.normalY;
    packed1[i * 4 + 2] = b.widthScale ?? 1;
    packed1[i * 4 + 3] = tierIndex(options.tier);
    const normal = b.terrainNormal;
    terrainNormal[i * 4] = normal[0];
    terrainNormal[i * 4 + 1] = normal[1];
    terrainNormal[i * 4 + 2] = normal[2];
    terrainNormal[i * 4 + 3] = 0;
    minX = Math.min(minX, b.offset[0]);
    minY = Math.min(minY, b.offset[1]);
    minZ = Math.min(minZ, b.offset[2]);
    maxX = Math.max(maxX, b.offset[0]);
    maxY = Math.max(maxY, b.offset[1] + height);
    maxZ = Math.max(maxZ, b.offset[2]);
  });
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geo.setAttribute("aPacked0", new THREE.InstancedBufferAttribute(packed0, 4));
  geo.setAttribute("aPacked1", new THREE.InstancedBufferAttribute(packed1, 4));
  geo.setAttribute("aTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormal, 4));
  geo.instanceCount = count;
  const margin = 4;
  geo.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX - margin, minY - margin, minZ - margin),
    new THREE.Vector3(maxX + margin, maxY + margin, maxZ + margin),
  );
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  base.dispose();
  return geo;
}
