// TSL vertex-stage sampling for static-topology water clipmap levels (Phase 5b).
//
// The static grid geometry stores grid indices (i, j) in position.xz; this builder turns
// them into world XZ from the per-snap origin uniform and fetches the per-vertex water
// data (waterY/terrainY/bodyMask/bodyKind + flow) from the level's toroidal texel
// textures with textureLoad. Both TSL water materials share it so static mode cannot
// drift between the perf and HQ paths.
//
// Only imported from the WebGPU-only material modules (keeps three/tsl out of the WebGL
// bundle, mirroring waterNodeMaterial's dynamic-import split).
import * as THREE from "three";
import {
  dFdx,
  dFdy,
  float,
  int,
  ivec2,
  max,
  mix,
  mod,
  positionLocal,
  positionWorld,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vertexStage,
} from "three/tsl";
import type { WaterStaticGridHandle, WaterStaticGridParams } from "./water_material_types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const WATER_RAMP_GUARD_FAR_CELL_SIZE = 12;

export function waterRampGuardEnabled(cellSize: number): boolean {
  return cellSize < WATER_RAMP_GUARD_FAR_CELL_SIZE;
}

/**
 * Near-level shoreline ramp suppression shared by static-texel and atlas grids.
 * The steepest sentinel ramps are rejected as complete fragments. Far/min-reduced
 * rings keep their deliberate shoreline dip untouched.
 */
export function buildWaterRampDiscard(
  depth: TslNode,
  flowSpeed: TslNode,
  cellSize: number,
): TslNode {
  if (!waterRampGuardEnabled(cellSize)) return float(0).greaterThan(float(1));

  const dx: TslNode = dFdx(positionWorld);
  const dy: TslNode = dFdy(positionWorld);
  const slopeX: TslNode = dx.y.div(max(dx.xz.length(), float(1e-5)));
  const slopeY: TslNode = dy.y.div(max(dy.xz.length(), float(1e-5)));
  const slope: TslNode = vec2(slopeX, slopeY).length();
  const limit: TslNode = mix(float(0.45), float(1.25), smoothstep(float(0.015), float(0.025), flowSpeed))
    .div(float(cellSize));

  const rampKeep: TslNode = float(1).sub(smoothstep(limit.mul(0.75), limit.mul(1.35), slope));
  const depthGate: TslNode = smoothstep(float(0.05), float(0.5), depth);
  const keep: TslNode = mix(float(1), rampKeep, depthGate);
  return keep.lessThan(float(0.5));
}

export interface WaterStaticGridNodes {
  /** Vertex-stage world position (mesh sits at identity, so local == world). */
  positionNode: TslNode;
  /** Fragment-interpolated equivalents of the legacy vertex attributes. */
  terrainY: TslNode;
  bodyMask: TslNode;
  bodyKind: TslNode;
  flow: TslNode;
  shoreDistance: TslNode;
  /** Fragment-side replacement for the legacy index-time height-discontinuity guard. */
  wallDiscard(depth: TslNode, flowSpeed: TslNode): TslNode;
  handle: WaterStaticGridHandle;
}

export function buildWaterStaticGridNodes(grid: WaterStaticGridParams): WaterStaticGridNodes {
  const uOriginMin = uniform(new THREE.Vector2()) as TslNode;
  const uBaseSlot = uniform(new THREE.Vector2()) as TslNode;
  const verts = float(grid.vertsPerEdge) as TslNode;

  // position.xz carries grid indices; both uniforms and indices are small integers, so
  // the float modulo is exact.
  const gridI: TslNode = positionLocal.x;
  const gridJ: TslNode = positionLocal.z;
  const slot: TslNode = ivec2(
    int(mod(uBaseSlot.x.add(gridI), verts)),
    int(mod(uBaseSlot.y.add(gridJ), verts)),
  );
  const texelA: TslNode = textureLoad(grid.texelsA, slot, int(0));
  const texelB: TslNode = textureLoad(grid.texelsB, slot, int(0));
  const texelC: TslNode = textureLoad(grid.texelsC, slot, int(0));
  const worldX: TslNode = uOriginMin.x.add(gridI.mul(float(grid.cellSize)));
  const worldZ: TslNode = uOriginMin.y.add(gridJ.mul(float(grid.cellSize)));
  const positionNode: TslNode = vec3(worldX, texelA.x, worldZ);

  const wallDiscard = (depth: TslNode, flowSpeed: TslNode): TslNode =>
    buildWaterRampDiscard(depth, flowSpeed, grid.cellSize);

  return {
    positionNode,
    terrainY: vertexStage(texelA.y),
    bodyMask: vertexStage(texelA.z),
    bodyKind: vertexStage(texelA.w),
    flow: vertexStage(texelB),
    shoreDistance: vertexStage(texelC.x),
    wallDiscard,
    handle: {
      setOrigin: (originMinX, originMinZ, baseSlotX, baseSlotZ) => {
        uOriginMin.value.set(originMinX, originMinZ);
        uBaseSlot.value.set(baseSlotX, baseSlotZ);
      },
    },
  };
}
