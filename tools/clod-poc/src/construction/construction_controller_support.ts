import * as THREE from "three";
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
  return placed.grounded !== undefined || placed.parentIds !== undefined;
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

export function createPieceGeometry(piece: ConstructionPieceDef): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(piece.dimensionsM[0], piece.dimensionsM[1], piece.dimensionsM[2]);
  const uv = geometry.getAttribute("uv");
  if (uv) geometry.setAttribute("uv2", uv.clone());
  return geometry;
}
