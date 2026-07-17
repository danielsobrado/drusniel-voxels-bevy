import * as THREE from "three";
import { normalizeRotationQuarterTurns } from "./construction_controller_support.js";
import type {
  ConstructionPieceDef,
  ConstructionSnapConfig,
  ConstructionSnapResult,
} from "./types.js";
import type { ConstructionSnapIndex } from "./snap_index.js";

const ROTATION_QUARTER_COUNT = 4;
const GHOST_VALID_COLOR = 0x35d46b;
const GHOST_SNAPPED_COLOR = 0x4ea1ff;
const GHOST_INVALID_COLOR = 0xff4f4f;

export interface FindConstructionSnapInput {
  ray: THREE.Ray;
  maxDistanceM: number;
  piece: ConstructionPieceDef;
  rotationQuarterTurns: number;
  snapIndex: ConstructionSnapIndex;
  config: ConstructionSnapConfig;
}

function candidateRotations(baseRotation: number): number[] {
  return Array.from({ length: ROTATION_QUARTER_COUNT }, (_, offset) =>
    normalizeRotationQuarterTurns(baseRotation + offset));
}

export function findConstructionSnapCandidates(input: FindConstructionSnapInput): ConstructionSnapResult[] {
  const releaseRadius = input.config.radiusM * Math.max(1, input.config.releaseRadiusMultiplier ?? 1.35);
  return input.snapIndex.findSnapCandidatesNearRay(
    [input.ray.origin.x, input.ray.origin.y, input.ray.origin.z],
    [input.ray.direction.x, input.ray.direction.y, input.ray.direction.z],
    input.maxDistanceM,
    input.piece,
    candidateRotations(input.rotationQuarterTurns),
    input.config,
    releaseRadius,
    input.rotationQuarterTurns,
  );
}

export function findBestConstructionSnap(input: FindConstructionSnapInput): ConstructionSnapResult | null {
  return findConstructionSnapCandidates(input)
    .find((candidate) => (candidate.rayDistanceM ?? 0) <= input.config.radiusM) ?? null;
}

export function updateConstructionGhost(
  ghostMesh: THREE.Mesh,
  ghostMaterial: THREE.MeshBasicMaterial,
  input: {
    position: readonly [number, number, number];
    rotationQuarterTurns: number;
    valid: boolean;
    snapped: boolean;
  },
): void {
  ghostMesh.visible = true;
  ghostMesh.position.set(input.position[0], input.position[1], input.position[2]);
  ghostMesh.rotation.set(0, input.rotationQuarterTurns * Math.PI * 0.5, 0);
  ghostMesh.scale.set(1, 1, 1);
  ghostMaterial.color.setHex(input.valid ? input.snapped ? GHOST_SNAPPED_COLOR : GHOST_VALID_COLOR : GHOST_INVALID_COLOR);
}
