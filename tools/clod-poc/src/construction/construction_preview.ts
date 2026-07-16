import * as THREE from "three";
import { normalizeRotationQuarterTurns } from "./construction_controller_support.js";
import type { TerrainHitPoint } from "./placement.js";
import type { ConstructionPieceDef, ConstructionSnapConfig, ConstructionSnapResult } from "./types.js";
import type { ConstructionSnapIndex } from "./snap_index.js";

const ROTATION_QUARTER_COUNT = 4;
const GHOST_VALID_COLOR = 0x35d46b;
const GHOST_SNAPPED_COLOR = 0x4ea1ff;
const GHOST_INVALID_COLOR = 0xff4f4f;

export interface FindConstructionSnapInput {
  ray: THREE.Ray;
  terrainHit: TerrainHitPoint;
  piece: ConstructionPieceDef;
  rotationQuarterTurns: number;
  snapIndex: ConstructionSnapIndex;
  config: ConstructionSnapConfig;
}

export function findBestConstructionSnap(input: FindConstructionSnapInput): ConstructionSnapResult | null {
  let best: ConstructionSnapResult | null = null;
  for (let offset = 0; offset < ROTATION_QUARTER_COUNT; offset += 1) {
    const rotation = normalizeRotationQuarterTurns(input.rotationQuarterTurns + offset);
    const snap = input.snapIndex.findBestSnapNearRay(
      [input.ray.origin.x, input.ray.origin.y, input.ray.origin.z],
      [input.ray.direction.x, input.ray.direction.y, input.ray.direction.z],
      input.terrainHit.distanceM + input.config.radiusM,
      input.piece,
      rotation,
      input.config,
    );
    if (!snap || (best && snap.score <= best.score)) continue;
    best = snap;
  }
  return best;
}

export function updateConstructionGhost(
  ghostMesh: THREE.Mesh,
  ghostMaterial: THREE.MeshBasicMaterial,
  input: {
    position: readonly [number, number, number];
    rotationQuarterTurns: number;
    dimensionsM: readonly [number, number, number];
    valid: boolean;
    snapped: boolean;
  },
): void {
  ghostMesh.visible = true;
  ghostMesh.position.set(input.position[0], input.position[1], input.position[2]);
  ghostMesh.rotation.set(0, input.rotationQuarterTurns * Math.PI * 0.5, 0);
  ghostMesh.scale.set(input.dimensionsM[0], input.dimensionsM[1], input.dimensionsM[2]);
  ghostMaterial.color.setHex(input.valid ? input.snapped ? GHOST_SNAPPED_COLOR : GHOST_VALID_COLOR : GHOST_INVALID_COLOR);
}
