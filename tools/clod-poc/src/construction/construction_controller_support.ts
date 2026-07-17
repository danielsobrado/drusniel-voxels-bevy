import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  ConstructionGeometryKind,
  ConstructionGeometryPart,
  ConstructionPieceDef,
  PlacedConstructionPiece,
} from "./types.js";

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
  return parsed.length > 0 ? [...new Set(parsed)].sort() : [];
}

export function hasExplicitSupportMetadata(placed: PlacedConstructionPiece): boolean {
  return placed.grounded !== undefined || placed.connectionIds !== undefined || placed.parentIds !== undefined;
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

function createPrimitiveGeometry(kind: ConstructionGeometryKind, dimensions: readonly [number, number, number]): THREE.BufferGeometry {
  const [x, y, z] = dimensions;
  switch (kind) {
    case "wedge":
      return createWedgeGeometry(dimensions);
    case "stairs":
      return createStairsGeometry(dimensions);
    case "cylinder":
      return new THREE.CylinderGeometry(Math.min(x, z) * 0.5, Math.min(x, z) * 0.5, y, 12);
    default:
      return new THREE.BoxGeometry(x, y, z);
  }
}

function createGeometryPart(part: ConstructionGeometryPart): THREE.BufferGeometry {
  const geometry = createPrimitiveGeometry(part.kind, part.dimensionsM);
  const rotation = part.rotationDegrees ?? [0, 0, 0];
  if (rotation[0]) geometry.rotateX(THREE.MathUtils.degToRad(rotation[0]));
  if (rotation[1]) geometry.rotateY(THREE.MathUtils.degToRad(rotation[1]));
  if (rotation[2]) geometry.rotateZ(THREE.MathUtils.degToRad(rotation[2]));
  geometry.translate(part.center[0], part.center[1], part.center[2]);
  return geometry;
}

function createCompoundGeometry(piece: ConstructionPieceDef): THREE.BufferGeometry | null {
  if (!piece.geometryParts || piece.geometryParts.length === 0) return null;
  const parts = piece.geometryParts.map(createGeometryPart);
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Failed to create compound construction geometry for ${piece.id}`);
  return merged;
}

export function createPieceGeometry(piece: ConstructionPieceDef): THREE.BufferGeometry {
  const geometry = createCompoundGeometry(piece)
    ?? createPrimitiveGeometry(piece.geometryKind ?? "box", piece.dimensionsM);
  if (piece.geometryYawDegrees) geometry.rotateY(THREE.MathUtils.degToRad(piece.geometryYawDegrees));
  geometry.computeBoundingBox();
  return addUv2(geometry);
}
