// Canonical GPU packing of the hydrology grid.
//
// This module is the ONLY place that defines how hydrology fields map to GPU texels.
// Every consumer (vegetation node materials, WGSL placement/scatter compute, understory
// ring compute, post-fx froxel volume) reads one of these two layouts; do not add another
// ad-hoc packing loop.
//
// Coordinate transform (both layouts): texel (ix, iz) in a res×res texture corresponds to
// world position (ix / (res-1) * worldCells, iz / (res-1) * worldCells). Samplers are
// nearest-filtered (no `float32-filterable` requirement); bilinear filtering is done
// manually in shader helpers (`placement_sample_hydro_bilinear` /
// `sampleHydrologyBilinearTsl`).
//
// Border behaviour: textures are clamp-to-edge, which is only meaningful INSIDE the
// startup world [0, worldCells]. Outside it the CPU authority is the infinite tile cache
// (hydrologyTileSource.ts); GPU consumers that need correct hydrology beyond the startup
// world need the streaming atlas (Phase 4b, deferred) — clamped edge values are a known
// approximation there, not a solution.
//
// Layout A — "water surface" (RGBA32F, res×res):
//   R = waterY          metres; dry cells carry a below-ground sentinel (carvedBed area
//                       minimum minus drySentinelDepth), so waterY < carvedBed when dry.
//   G = wetMask         0 or 1 (1 inside a water body after the final surface build).
//   B = carvedBedY      metres; the height terrain is actually built at.
//   A = shoreDistance   metres; unsigned chamfer distance to the nearest wet<->dry
//                       boundary (0 on the boundary, grows inland AND into open water).
//
// Layout B — "render fields" (RGBA32F, res×res):
//   R = flowX           flow direction X pre-scaled by flow strength (grid.flowDirX).
//   G = flowZ           flow direction Z pre-scaled by flow strength (grid.flowDirZ).
//                       speed = length(RG); direction = normalize(RG) when speed > 0.
//   B = moisture        [0, 1] blurred wetness field for terrain/fog tinting.
//   A = bodyKind / 255  HYDROLOGY_BODY_* enum normalised to [0, 1].
import type { HydrologyGrid } from "./hydrologyGrid.js";

/** Structural subset of HydrologyGrid needed for Layout A (keeps tools/tests light). */
export interface HydrologyWaterSurfaceFields {
  res: number;
  waterY: Float32Array;
  wetMask: Float32Array;
  carvedBed: Float32Array;
  shoreDistance: Float32Array;
}

export function packHydrologyWaterSurfaceTexels(grid: HydrologyWaterSurfaceFields): Float32Array {
  const { res, waterY, wetMask, carvedBed, shoreDistance } = grid;
  const data = new Float32Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = waterY[i];
    data[i * 4 + 1] = wetMask[i];
    data[i * 4 + 2] = carvedBed[i];
    data[i * 4 + 3] = shoreDistance[i];
  }
  return data;
}

export function packHydrologyFieldsTexels(grid: HydrologyGrid): Float32Array {
  const { res, flowDirX, flowDirZ, moisture, bodyKind } = grid;
  const data = new Float32Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = flowDirX[i];
    data[i * 4 + 1] = flowDirZ[i];
    data[i * 4 + 2] = moisture[i];
    data[i * 4 + 3] = bodyKind[i] / 255;
  }
  return data;
}
