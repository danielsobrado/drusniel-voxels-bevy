import type { PageMesh, ClodPageNode } from "./types.js";
import type { GpuClodRootMesher } from "./terrain/streaming/gpu_clod_root_mesher.js";
import { continentTileMeshingEnabled } from "./terrain/streaming/streamed_root_gpu_config.js";
import { uploadHeightfieldTilesForPage } from "./world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import type { StreamRootBuildLegEvidence } from "./core/hooks.js";
import type { ClodPagesConfig } from "./config.js";

export type StreamRootCompareCoord = { px: number; pz: number; level?: number };

export interface StreamRootCompareBuildResult {
  nodes: ClodPageNode[];
  buildMs: number;
  transferBytes: number;
}

export function streamRootLegEvidence(mesh: PageMesh, buildMs: number): StreamRootBuildLegEvidence {
  let minY: number | null = null;
  let maxY: number | null = null;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i];
    if (minY === null || y < minY) minY = y;
    if (maxY === null || y > maxY) maxY = y;
  }
  return {
    ok: true,
    error: null,
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    minY,
    maxY,
    buildMs,
  };
}

export function streamRootLegFailure(error: unknown, buildMs: number): StreamRootBuildLegEvidence {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { ok: false, error: message, triangles: 0, vertices: 0, minY: null, maxY: null, buildMs };
}

function gpuTileMeshRequested(): boolean {
  return typeof window !== "undefined" && continentTileMeshingEnabled(new URLSearchParams(window.location.search));
}

export async function compareStreamRootGpuLeg(opts: {
  mesher: GpuClodRootMesher | null;
  coord: StreamRootCompareCoord;
  id: string;
  cfg: ClodPagesConfig | null;
}): Promise<StreamRootBuildLegEvidence> {
  const { mesher, coord, id, cfg } = opts;
  const startedAt = performance.now();
  if (!mesher) return streamRootLegFailure(new Error("WebGPU streamed-root mesher unavailable"), 0);
  try {
    if (gpuTileMeshRequested()) {
      const pageSize = cfg!.page.chunks_per_page * cfg!.page.chunk_size;
      if (!uploadHeightfieldTilesForPage(coord, pageSize)) {
        throw new Error(`GPU tile mesher missing resident heightfield tile for ${id}`);
      }
    }
    const built = await mesher.buildPages([{ px: coord.px, pz: coord.pz, level: coord.level }]);
    const node = built.nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`GPU build returned no node for ${id}`);
    return streamRootLegEvidence(node.mesh, performance.now() - startedAt);
  } catch (error) {
    return streamRootLegFailure(error, performance.now() - startedAt);
  }
}

export async function compareStreamRootCpuLeg(opts: {
  coord: StreamRootCompareCoord;
  id: string;
  buildOnWorker: (
    coords: readonly StreamRootCompareCoord[],
    bypassCacheIds?: readonly string[],
  ) => Promise<StreamRootCompareBuildResult>;
}): Promise<StreamRootBuildLegEvidence> {
  const { coord, id, buildOnWorker } = opts;
  const startedAt = performance.now();
  try {
    const built = await buildOnWorker([coord], [id]);
    const node = built.nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`CPU build returned no node for ${id}`);
    return streamRootLegEvidence(node.mesh, performance.now() - startedAt);
  } catch (error) {
    return streamRootLegFailure(error, performance.now() - startedAt);
  }
}
