import { constructionPlacementBoxes } from "./construction_proxy.js";
import type { ConstructionPieceDef } from "./types.js";

export interface ConstructionBounds3d {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function isFiniteConstructionPosition(value: readonly [number, number, number]): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}

function rotateLocalXZ(x: number, z: number, yawRadians: number): readonly [number, number] {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return [x * cos + z * sin, -x * sin + z * cos];
}

export function constructionBoundsFor(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  insetM = 0,
): ConstructionBounds3d {
  const objectYaw = rotationQuarterTurns * Math.PI * 0.5;
  const result: ConstructionBounds3d = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };

  for (const proxy of constructionPlacementBoxes(piece)) {
    const localYaw = (proxy.rotationYDegrees ?? 0) * Math.PI / 180;
    const totalYaw = objectYaw + localYaw;
    const [offsetX, offsetZ] = rotateLocalXZ(proxy.center[0], proxy.center[2], objectYaw);
    const centerX = position[0] + offsetX;
    const centerY = position[1] + proxy.center[1];
    const centerZ = position[2] + offsetZ;
    const hx = Math.max(0, proxy.dimensionsM[0] * 0.5 - insetM);
    const hy = Math.max(0, proxy.dimensionsM[1] * 0.5 - insetM);
    const hz = Math.max(0, proxy.dimensionsM[2] * 0.5 - insetM);
    const cos = Math.abs(Math.cos(totalYaw));
    const sin = Math.abs(Math.sin(totalYaw));
    const extentX = cos * hx + sin * hz;
    const extentZ = sin * hx + cos * hz;
    result.minX = Math.min(result.minX, centerX - extentX);
    result.maxX = Math.max(result.maxX, centerX + extentX);
    result.minY = Math.min(result.minY, centerY - hy);
    result.maxY = Math.max(result.maxY, centerY + hy);
    result.minZ = Math.min(result.minZ, centerZ - extentZ);
    result.maxZ = Math.max(result.maxZ, centerZ + extentZ);
  }

  return result;
}

export function rotatedConstructionDimensions(
  piece: ConstructionPieceDef,
  rotationQuarterTurns: number,
): readonly [number, number, number] {
  const bounds = constructionBoundsFor(piece, [0, 0, 0], rotationQuarterTurns);
  return [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ];
}

export function constructionBoundsOverlap(a: ConstructionBounds3d, b: ConstructionBounds3d): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
    && a.minY <= b.maxY && a.maxY >= b.minY
    && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}
