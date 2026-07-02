import { type BrushShape, type BrushOp, type DigEdit } from "../terrain/terrain.js";
import type { ResolvedDigEdit } from "./terrain_field_core_types.js";

export const SHAPE_SPHERE = 0;
export const SHAPE_CUBE = 1;
export const SHAPE_CYLINDER = 2;
export const DIG_INFLUENCE_MARGIN = 4;

function shapeId(shape: BrushShape | undefined): number {
  if (shape === "cube") return SHAPE_CUBE;
  if (shape === "cylinder") return SHAPE_CYLINDER;
  return SHAPE_SPHERE;
}

function brushSdfCore(shape: number, dx: number, dy: number, dz: number, r: number, h: number): number {
  if (shape === SHAPE_CUBE) {
    const qx = Math.abs(dx) - r, qy = Math.abs(dy) - h, qz = Math.abs(dz) - r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0);
  }
  if (shape === SHAPE_CYLINDER) {
    const dRadial = Math.hypot(dx, dz) - r, dAxial = Math.abs(dy) - h;
    const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
    return outside + Math.min(Math.max(dRadial, dAxial), 0);
  }
  return Math.hypot(dx, (dy * r) / h, dz) - r;
}

function brushWeight(sdf: number, falloff: number, r: number, strength: number): number {
  if (falloff > 0) {
    return Math.min(1, Math.max(0, -sdf / Math.max(1e-3, falloff * r))) * strength;
  }
  return sdf <= 0 ? strength : 0;
}

export function resolveDigEdits(edits: readonly DigEdit[]): ResolvedDigEdit[] {
  return edits.map((e) => {
    const h = e.height ?? e.r;
    const op: BrushOp = e.op ?? "remove";
    return {
      x: e.x,
      y: e.y,
      z: e.z,
      r: e.r,
      h,
      shape: shapeId(e.shape),
      opAdd: op === "add" ? 1 : 0,
      strength: e.strength ?? 1,
      falloff: e.falloff ?? 0,
      material: Math.max(0, (e.material ?? 0) | 0),
    };
  });
}

export { brushSdfCore, brushWeight };
