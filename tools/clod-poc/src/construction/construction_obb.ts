import { constructionPlacementBoxes } from "./construction_proxy.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

interface ConstructionObb {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  axisX: readonly [number, number];
  axisZ: readonly [number, number];
}

function rotateLocalXZ(x: number, z: number, yawRadians: number): readonly [number, number] {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return [x * cos + z * sin, -x * sin + z * cos];
}

function obbsFor(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  insetM: number,
): ConstructionObb[] {
  const objectYaw = rotationQuarterTurns * Math.PI * 0.5;
  return constructionPlacementBoxes(piece).map((proxy) => {
    const totalYaw = objectYaw + (proxy.rotationYDegrees ?? 0) * Math.PI / 180;
    const [offsetX, offsetZ] = rotateLocalXZ(proxy.center[0], proxy.center[2], objectYaw);
    const cos = Math.cos(totalYaw);
    const sin = Math.sin(totalYaw);
    return {
      centerX: position[0] + offsetX,
      centerY: position[1] + proxy.center[1],
      centerZ: position[2] + offsetZ,
      halfX: Math.max(0, proxy.dimensionsM[0] * 0.5 - insetM),
      halfY: Math.max(0, proxy.dimensionsM[1] * 0.5 - insetM),
      halfZ: Math.max(0, proxy.dimensionsM[2] * 0.5 - insetM),
      axisX: [cos, -sin],
      axisZ: [sin, cos],
    };
  });
}

function projectionRadius(obb: ConstructionObb, axis: readonly [number, number]): number {
  const x = Math.abs(obb.axisX[0] * axis[0] + obb.axisX[1] * axis[1]);
  const z = Math.abs(obb.axisZ[0] * axis[0] + obb.axisZ[1] * axis[1]);
  return obb.halfX * x + obb.halfZ * z;
}

function separatedOnAxis(a: ConstructionObb, b: ConstructionObb, axis: readonly [number, number]): boolean {
  const dx = b.centerX - a.centerX;
  const dz = b.centerZ - a.centerZ;
  const distance = Math.abs(dx * axis[0] + dz * axis[1]);
  return distance > projectionRadius(a, axis) + projectionRadius(b, axis);
}

export function constructionObbsOverlap(a: ConstructionObb, b: ConstructionObb): boolean {
  if (Math.abs(a.centerY - b.centerY) > a.halfY + b.halfY) return false;
  return !separatedOnAxis(a, b, a.axisX)
    && !separatedOnAxis(a, b, a.axisZ)
    && !separatedOnAxis(a, b, b.axisX)
    && !separatedOnAxis(a, b, b.axisZ);
}

export function constructionPiecesOverlap(input: {
  piece: ConstructionPieceDef;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  otherPiece: ConstructionPieceDef;
  other: PlacedConstructionPiece;
  insetM: number;
}): boolean {
  const a = obbsFor(input.piece, input.position, input.rotationQuarterTurns, input.insetM);
  const b = obbsFor(input.otherPiece, input.other.position, input.other.rotationQuarterTurns, input.insetM);
  for (const left of a) for (const right of b) if (constructionObbsOverlap(left, right)) return true;
  return false;
}

export const constructionObbMath = { obbsFor };
