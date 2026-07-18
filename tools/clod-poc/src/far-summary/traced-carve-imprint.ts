import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryTile } from "./types.js";

/**
 * Apply the far-LOD traced-carve imprint to a freshly built tile. CPU builds bake the
 * carve through the height grid in `createFarSummaryTileBuild`; GPU builds evaluate the
 * base field in WGSL where the traced polylines do not exist, so their committed cells
 * re-apply the same carve here before entering the cache.
 *
 * Must run exactly once per built tile: the min/max/occluder shift is a delta against
 * the incoming heights. Water-snapshot clones taken later inherit the imprinted values.
 */
export function imprintTracedCarveOnFarSummaryTile(
  tile: FarSummaryTile,
  terrainSampler: FarTerrainSampler,
): void {
  const carve = terrainSampler.carveHeightImprint;
  if (!carve) return;
  for (let index = 0; index < tile.samples.length; index++) {
    const sample = tile.samples[index];
    if (!sample || !Number.isFinite(sample.heightAvg)) continue;
    const sx = index % tile.tileCells;
    const sz = Math.floor(index / tile.tileCells);
    const wx = tile.originX + (sx + 0.5) * tile.cellSizeM;
    const wz = tile.originZ + (sz + 0.5) * tile.cellSizeM;
    const carved = carve(wx, wz, sample.heightAvg, tile.cellSizeM);
    const delta = carved - sample.heightAvg;
    if (!(delta < -0.01)) continue;
    sample.heightAvg = carved;
    if (Number.isFinite(sample.heightMin)) sample.heightMin += delta;
    if (Number.isFinite(sample.heightMax)) sample.heightMax += delta;
    // Lowering the occluder with the terrain is the conservative direction: an occluder
    // left above the carved bed would falsely cull geometry visible through the channel.
    if (Number.isFinite(sample.occluderHeight)) sample.occluderHeight += delta;
  }
}
