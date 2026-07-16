import * as THREE from "three";
import { createTreeBakedImpostorGeometry, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { OctahedralFrame } from "./tree_impostor_octahedral.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";

export interface TreeGpuRingGeometryInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  geometries: TreeGeometryMap;
  settings: TreeSettings;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>;
}

export interface TreeGpuRingGeometryResult {
  geometry: THREE.BufferGeometry;
  bakedImpostor: boolean;
}

const EMPTY_GPU_RING_IMPOSTOR_GEOMETRY = new THREE.BufferGeometry();

export function selectTreeGpuRingGeometry(input: TreeGpuRingGeometryInput): TreeGpuRingGeometryResult {
  if (input.lod !== "impostor") {
    return { geometry: input.geometries[input.species][input.lod], bakedImpostor: false };
  }

  const atlas = input.impostorAtlases[input.species];
  if (!input.settings.impostors.enabled) {
    return { geometry: EMPTY_GPU_RING_IMPOSTOR_GEOMETRY, bakedImpostor: false };
  }
  if (!atlas?.ready) {
    const fallback = input.settings.impostors.fallbackToPlaceholder
      ? input.geometries[input.species].impostor
      : input.geometries[input.species].far;
    return { geometry: fallback, bakedImpostor: false };
  }

  input.bakedImpostorGeometries[input.species] ??= createTreeGpuRingBakedImpostorGeometry(
    input.species,
    input.settings,
    atlas,
  );
  return { geometry: input.bakedImpostorGeometries[input.species]!, bakedImpostor: true };
}

export function createTreeGpuRingBakedImpostorGeometry(
  species: TreeSpeciesId,
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.BufferGeometry {
  return createTreeBakedImpostorGeometry(species, settings, atlas);
}

export function selectTreeGpuRingFallbackFrame(atlas: TreeImpostorAtlas): OctahedralFrame {
  if (atlas.frames.length === 0) {
    return {
      index: 0,
      x: 0,
      y: 0,
      uvMin: [0, 0],
      uvMax: [1, 1],
      direction: [0, 0, 1],
    };
  }
  let best = atlas.frames[0];
  let bestZ = best.direction[2];
  for (const frame of atlas.frames) {
    if (frame.direction[2] > bestZ) {
      best = frame;
      bestZ = frame.direction[2];
    }
  }
  return best;
}

export function mapTreeGpuRingBakedImpostorUvToFrame(
  geometry: THREE.BufferGeometry,
  frame: Pick<OctahedralFrame, "uvMin" | "uvMax">,
): void {
  const uv = geometry.getAttribute("uv");
  if (!uv) return;
  const mapped = new Float32Array(uv.count * 2);
  const minU = frame.uvMin[0];
  const minV = frame.uvMin[1];
  const maxU = frame.uvMax[0];
  const maxV = frame.uvMax[1];
  for (let index = 0; index < uv.count; index++) {
    mapped[index * 2] = THREE.MathUtils.lerp(minU, maxU, uv.getX(index));
    mapped[index * 2 + 1] = THREE.MathUtils.lerp(minV, maxV, uv.getY(index));
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(mapped, 2));
}
