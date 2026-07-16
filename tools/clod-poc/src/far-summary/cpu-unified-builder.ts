import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryRingRequest, TileBounds } from "./clipmap-rings.js";
import type { FarSummaryCache } from "./summary-cache.js";
import {
  createFarSummaryTileBuild,
  finishFarSummaryTileBuild,
  stepFarSummaryTileBuild,
  type FarSummaryTileBuildState,
  type FarTerrainSampler,
} from "./summary-tile-builder.js";
import type { FarSummaryTile } from "./types.js";

interface ActiveCpuBuild {
  key: string;
  state: FarSummaryTileBuildState;
}

export interface FarSummaryCpuBaseBuilderOptions {
  config: FarSummaryConfig;
  cache: FarSummaryCache;
  terrainSampler: FarTerrainSampler;
  isEnrichmentPending: (key: string) => boolean;
  onBuilt: (key: string, tile: FarSummaryTile) => void;
}

export class FarSummaryCpuBaseBuilder {
  private readonly config: FarSummaryConfig;
  private readonly cache: FarSummaryCache;
  private readonly terrainSampler: FarTerrainSampler;
  private readonly isEnrichmentPending: (key: string) => boolean;
  private readonly onBuilt: (key: string, tile: FarSummaryTile) => void;
  private active: ActiveCpuBuild | null = null;
  private completedBaseTiles = 0;

  constructor(options: FarSummaryCpuBaseBuilderOptions) {
    this.config = options.config;
    this.cache = options.cache;
    this.terrainSampler = options.terrainSampler;
    this.isEnrichmentPending = options.isEnrichmentPending;
    this.onBuilt = options.onBuilt;
  }

  buildSome(
    requests: readonly FarSummaryRingRequest[],
    frameIndex: number,
    nowMs: number,
    overrideMaxBuilds: number | undefined,
    deadlineMs: number,
  ): void {
    this.prune(requests);
    // Matches `FarSummaryTileCache.buildSomeTiles`: undefined means "use the config steady-state
    // budget". Taking it literally would make the bound NaN and build nothing.
    const maxBuilds = Math.max(0, overrideMaxBuilds ?? this.config.stream.maxTileBuildsPerFrame);
    let completed = 0;

    while (completed < maxBuilds) {
      if (!this.active) {
        const request = this.nextRequest(requests);
        if (!request) return;

        const ringConfig = this.config.rings[request.ring];
        if (!ringConfig) {
          console.warn(`[far-summary] missing ring config for CPU base build ring ${request.ring}`);
          return;
        }

        this.active = {
          key: requestKey(request),
          state: createFarSummaryTileBuild({
            key: request.key,
            ringConfig,
            terrainSampler: this.terrainSampler,
            frameIndex,
            nowMs,
          }),
        };
      }

      this.active.state.input.frameIndex = frameIndex;
      this.active.state.input.nowMs = nowMs;
      if (!stepFarSummaryTileBuild(this.active.state, deadlineMs)) return;

      const complete = this.active;
      const tile = finishFarSummaryTileBuild(complete.state);
      this.active = null;
      this.completedBaseTiles++;
      completed++;
      this.onBuilt(complete.key, tile);

      if (performance.now() >= deadlineMs) return;
    }
  }

  has(key: string): boolean {
    return this.active?.key === key;
  }

  buildingCount(): number {
    return this.active ? 1 : 0;
  }

  completedBaseTilesTotal(): number {
    return this.completedBaseTiles;
  }

  reset(): void {
    this.active = null;
  }

  invalidate(bounds: TileBounds | null): boolean {
    if (!this.active) return false;
    if (bounds !== null) {
      const { originX, originZ } = this.active.state;
      const { cellM, tileCells } = this.active.state.input.ringConfig;
      const maxX = originX + cellM * tileCells;
      const maxZ = originZ + cellM * tileCells;
      if (originX >= bounds.maxX || maxX <= bounds.minX || originZ >= bounds.maxZ || maxZ <= bounds.minZ) {
        return false;
      }
    }
    this.active = null;
    return true;
  }

  private prune(requests: readonly FarSummaryRingRequest[]): void {
    if (!this.active) return;
    const required = new Set(requests.map(requestKey));
    if (!required.has(this.active.key)) this.active = null;
  }

  private nextRequest(requests: readonly FarSummaryRingRequest[]): FarSummaryRingRequest | null {
    for (const request of requests) {
      const key = requestKey(request);
      if (this.isEnrichmentPending(key) || this.has(key)) continue;

      const tile = this.cache.getTile(request.key);
      if (tile?.state === "ready" || tile?.state === "building") continue;

      return request;
    }
    return null;
  }
}

export function createFarSummaryBaseSampler(source: FarTerrainSampler): FarTerrainSampler {
  const sampler: FarTerrainSampler = {
    sampleHeight: (x, z) => source.sampleHeight(x, z),
  };
  if (source.sampleMaterial) {
    sampler.sampleMaterial = (x, z) => source.sampleMaterial!(x, z);
  }
  if (source.sampleStructureCoverage) {
    sampler.sampleStructureCoverage = (x, z, cellSizeM) =>
      source.sampleStructureCoverage!(x, z, cellSizeM);
  }
  return sampler;
}

export function requestKey(request: FarSummaryRingRequest): string {
  return `${request.key.ring}:${request.key.x}:${request.key.z}:${request.key.cellSizeM}`;
}
