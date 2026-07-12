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

export interface WaterStaticGridNodes {
  /** Vertex-stage world position (mesh sits at identity, so local == world). */
  positionNode: TslNode;
  /** Fragment-interpolated equivalents of the legacy vertex attributes. */
  terrainY: TslNode;
  bodyMask: TslNode;
  bodyKind: TslNode;
  flow: TslNode;
  /**
   * Fragment-side replacement for the legacy index-time height-discontinuity guard
   * (waterQuadRenderable): the CPU used to skip quads whose wet corners spanned more
   * than 0.45 m (1.25 m when flowing); with a static index buffer those quads now
   * rasterize as near-vertical walls, so fragments steeper than the same per-cell
   * threshold are discarded instead. The depth gate keeps genuine shoreline ramps
   * (wet corner next to a dry sentinel corner) intact — their visible fragments sit
   * within half a metre of the waterline, where walls have real depth.
   */
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
  const worldX: TslNode = uOriginMin.x.add(gridI.mul(float(grid.cellSize)));
  const worldZ: TslNode = uOriginMin.y.add(gridJ.mul(float(grid.cellSize)));
  const positionNode: TslNode = vec3(worldX, texelA.x, worldZ);

  const wallDiscard = (depth: TslNode, flowSpeed: TslNode): TslNode => {
    const dx: TslNode = dFdx(positionWorld);
    const dy: TslNode = dFdy(positionWorld);
    const slopeX: TslNode = dx.y.div(max(dx.xz.length(), float(1e-5)));
    const slopeY: TslNode = dy.y.div(max(dy.xz.length(), float(1e-5)));
    const slope: TslNode = vec2(slopeX, slopeY).length();
    // Same thresholds as waterQuadRenderable, converted from per-quad ΔY to slope.
    const limit: TslNode = mix(float(0.45), float(1.25), smoothstep(float(0.015), float(0.025), flowSpeed))
      .div(float(grid.cellSize));
    return slope.greaterThan(limit).and(depth.greaterThan(float(0.5)));
  };

  return {
    positionNode,
    terrainY: vertexStage(texelA.y),
    bodyMask: vertexStage(texelA.z),
    bodyKind: vertexStage(texelA.w),
    flow: vertexStage(texelB),
    wallDiscard,
    handle: {
      setOrigin: (originMinX, originMinZ, baseSlotX, baseSlotZ) => {
        uOriginMin.value.set(originMinX, originMinZ);
        uBaseSlot.value.set(baseSlotX, baseSlotZ);
      },
    },
  };
}
