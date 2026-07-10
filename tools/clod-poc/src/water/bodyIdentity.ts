// Body identity and shoreline distance for the hydrology grid.
//
// computeBodyIds() flood-fills the final wet mask into connected components so every
// water body has a stable id. Connectivity is gated by hydrological *class* (flowing
// river vs still lake/pond/marsh vs ocean) so a river feeding a lake is a distinct id
// from the lake it feeds. This lets surface smoothing stay body-aware and lets lakes be
// flattened per body without dragging river cells with them.
//
// computeShoreDistance() runs a two-pass chamfer distance transform on the wet mask so
// each cell knows how far (in world metres) it is from the nearest wet<->dry boundary.
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
  gridIndex,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

export const BODY_CLASS_NONE = 0;
export const BODY_CLASS_FLOWING = 1; // river
export const BODY_CLASS_STILL = 2; // lake / pond / marsh
export const BODY_CLASS_OCEAN = 3;

/** Hydrological connectivity class for a body kind (cells only connect within a class). */
export function bodyClass(kind: number): number {
  switch (kind) {
    case HYDROLOGY_BODY_RIVER:
      return BODY_CLASS_FLOWING;
    case HYDROLOGY_BODY_LAKE:
    case HYDROLOGY_BODY_POND:
    case HYDROLOGY_BODY_MARSH:
      return BODY_CLASS_STILL;
    case HYDROLOGY_BODY_OCEAN:
      return BODY_CLASS_OCEAN;
    default:
      return BODY_CLASS_NONE;
  }
}

export function isStillBodyKind(kind: number): boolean {
  return kind === HYDROLOGY_BODY_LAKE || kind === HYDROLOGY_BODY_POND || kind === HYDROLOGY_BODY_MARSH;
}

/**
 * Assign a stable connected-component id to every wet cell (0 = dry). Two wet cells are
 * connected only when 4-adjacent and in the same {@link bodyClass}. Runs after the water
 * surface is final so it reflects any cells the surface build turned dry.
 */
export function computeBodyIds(grid: HydrologyGrid): void {
  const { res, wetMask, bodyKind, bodyId } = grid;
  bodyId.fill(0);
  const count = res * res;
  const stack = new Int32Array(count);
  let nextId = 1;
  for (let start = 0; start < count; start++) {
    if (bodyId[start] !== 0 || wetMask[start] <= 0.5) continue;
    const classId = bodyClass(bodyKind[start]);
    if (classId === BODY_CLASS_NONE) continue;
    const id = nextId++;
    let sp = 0;
    stack[sp++] = start;
    bodyId[start] = id;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % res;
      const z = (i - x) / res;
      if (x > 0) sp = visit(i - 1, id, classId, sp);
      if (x < res - 1) sp = visit(i + 1, id, classId, sp);
      if (z > 0) sp = visit(i - res, id, classId, sp);
      if (z < res - 1) sp = visit(i + res, id, classId, sp);
    }
  }

  function visit(ni: number, id: number, classId: number, sp: number): number {
    if (bodyId[ni] !== 0 || wetMask[ni] <= 0.5) return sp;
    if (bodyClass(bodyKind[ni]) !== classId) return sp;
    bodyId[ni] = id;
    stack[sp++] = ni;
    return sp;
  }
}

/**
 * Chamfer (3-4) distance transform giving each cell its unsigned distance in world
 * metres to the nearest wet<->dry boundary. Cheap O(cells), two passes.
 */
export function computeShoreDistance(grid: HydrologyGrid): void {
  const { res, wetMask, shoreDistance, texel } = grid;
  const INF = 1e9;
  // Seed: boundary cells (a wet cell touching dry, or vice-versa) are distance 0.
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const wet = wetMask[i] > 0.5;
      let boundary = false;
      if (x > 0 && wetMask[i - 1] > 0.5 !== wet) boundary = true;
      else if (x < res - 1 && wetMask[i + 1] > 0.5 !== wet) boundary = true;
      else if (z > 0 && wetMask[i - res] > 0.5 !== wet) boundary = true;
      else if (z < res - 1 && wetMask[i + res] > 0.5 !== wet) boundary = true;
      shoreDistance[i] = boundary ? 0 : INF;
    }
  }
  const D1 = 1;
  const D2 = Math.SQRT2;
  // Forward pass.
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      let d = shoreDistance[i];
      if (x > 0) d = Math.min(d, shoreDistance[i - 1] + D1);
      if (z > 0) d = Math.min(d, shoreDistance[i - res] + D1);
      if (x > 0 && z > 0) d = Math.min(d, shoreDistance[i - res - 1] + D2);
      if (x < res - 1 && z > 0) d = Math.min(d, shoreDistance[i - res + 1] + D2);
      shoreDistance[i] = d;
    }
  }
  // Backward pass.
  for (let z = res - 1; z >= 0; z--) {
    for (let x = res - 1; x >= 0; x--) {
      const i = gridIndex(res, x, z);
      let d = shoreDistance[i];
      if (x < res - 1) d = Math.min(d, shoreDistance[i + 1] + D1);
      if (z < res - 1) d = Math.min(d, shoreDistance[i + res] + D1);
      if (x < res - 1 && z < res - 1) d = Math.min(d, shoreDistance[i + res + 1] + D2);
      if (x > 0 && z < res - 1) d = Math.min(d, shoreDistance[i + res - 1] + D2);
      shoreDistance[i] = d;
    }
  }
  // Convert cell counts to world metres.
  for (let i = 0; i < shoreDistance.length; i++) {
    shoreDistance[i] = Math.min(shoreDistance[i], INF) * texel;
  }
}
