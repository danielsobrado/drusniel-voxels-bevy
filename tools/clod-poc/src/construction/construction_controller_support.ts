import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

export const GHOST_VALID_COLOR = 0x35d46b;
export const GHOST_SNAPPED_COLOR = 0x4ea1ff;
export const GHOST_INVALID_COLOR = 0xff4f4f;
export const MENU_ID = "construction-build-menu";
export const ROTATION_QUARTER_COUNT = 4;
export const RAYCAST_REFINE_STEPS = 12;
export const ENTITY_ID_PREFIX = "piece-";
export const BUILD_POINTER_OPTIONS = { capture: true } as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeStyleUrl(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export function normalizeRotationQuarterTurns(value: number): number {
  const turns = Math.trunc(value);
  return ((turns % ROTATION_QUARTER_COUNT) + ROTATION_QUARTER_COUNT) % ROTATION_QUARTER_COUNT;
}

export function asFiniteVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : null;
}

export function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return parsed.length > 0 ? parsed : [];
}

export function hasExplicitSupportMetadata(placed: PlacedConstructionPiece): boolean {
  return placed.grounded !== undefined
    || placed.parentIds !== undefined
    || placed.connectionIds !== undefined
    || placed.stability !== undefined;
}

export function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

function addUv2(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.getAttribute("uv");
  if (uv) geometry.setAttribute("uv2", uv.clone());
  return geometry;
}

function createWedgeGeometry(dimensions: readonly [number, number, number]): THREE.BufferGeometry {
  const [width, height, depth] = dimensions;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const position = geometry.getAttribute("position");
  const halfHeight = height * 0.5;
  for (let index = 0; index < position.count; index += 1) {
    if (position.getZ(index) > 0 && position.getY(index) > 0) position.setY(index, -halfHeight);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createStairsGeometry(dimensions: readonly [number, number, number]): THREE.BufferGeometry {
  const [width, height, depth] = dimensions;
  const stepCount = 4;
  const parts: THREE.BufferGeometry[] = [];
  for (let step = 0; step < stepCount; step += 1) {
    const stepHeight = height * ((step + 1) / stepCount);
    const stepDepth = depth / stepCount;
    const geometry = new THREE.BoxGeometry(width, stepHeight, stepDepth);
    geometry.translate(0, -height * 0.5 + stepHeight * 0.5, -depth * 0.5 + stepDepth * (step + 0.5));
    parts.push(geometry);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("Failed to create construction stairs geometry");
  return merged;
}

export function createPieceGeometry(piece: ConstructionPieceDef): THREE.BufferGeometry {
  const [x, y, z] = piece.dimensionsM;
  let geometry: THREE.BufferGeometry;
  switch (piece.geometryKind ?? "box") {
    case "wedge":
      geometry = createWedgeGeometry(piece.dimensionsM);
      break;
    case "stairs":
      geometry = createStairsGeometry(piece.dimensionsM);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(Math.min(x, z) * 0.5, Math.min(x, z) * 0.5, y, 12);
      break;
    default:
      geometry = new THREE.BoxGeometry(x, y, z);
      break;
  }
  if (piece.geometryYawDegrees) geometry.rotateY(THREE.MathUtils.degToRad(piece.geometryYawDegrees));
  geometry.computeBoundingBox();
  return addUv2(geometry);
}
