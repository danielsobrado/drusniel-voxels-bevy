import * as THREE from "three";
import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryCache } from "./summary-cache.js";
import type { FarSummarySample } from "./types.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";

export interface FarHeightProvider {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
  sampleMaterial?(x: number, z: number): number;
}

export class FarSummaryClipmapSampler implements FarHeightProvider {
  private readonly cache: FarSummaryCache;
  private readonly config: FarSummaryConfig;
  private readonly terrainSampler: FarTerrainSampler;
  private readonly _stats = {
    cacheHits: 0,
    cacheMisses: 0,
    proceduralFallbacks: 0,
    lowerRingFallbacks: 0,
  };

  constructor(
    cache: FarSummaryCache,
    config: FarSummaryConfig,
    terrainSampler: FarTerrainSampler,
  ) {
    this.cache = cache;
    this.config = config;
    this.terrainSampler = terrainSampler;
  }

  get stats() {
    return this._stats;
  }

  resetFrameStats(): void {
    this._stats.cacheHits = 0;
    this._stats.cacheMisses = 0;
    this._stats.proceduralFallbacks = 0;
    this._stats.lowerRingFallbacks = 0;
  }

  sampleHeight(x: number, z: number, preferredRing?: number): number {
    const sample = this.sampleFull(x, z, preferredRing);
    return sample.heightAvg;
  }

  sampleNormal(x: number, z: number, preferredRing?: number): THREE.Vector3 {
    const sample = this.sampleFull(x, z, preferredRing);
    return new THREE.Vector3(sample.normalX, sample.normalY, sample.normalZ);
  }

  sampleMaterial(x: number, z: number, preferredRing?: number): number {
    const sample = this.sampleFull(x, z, preferredRing);
    return sample.dominantMaterial;
  }

  sampleCanopyCoverage(x: number, z: number, preferredRing?: number): number {
    const sample = this.sampleFull(x, z, preferredRing);
    return sample.canopyCoverage;
  }

  sampleWaterCoverage(x: number, z: number, preferredRing?: number): number {
    const sample = this.sampleFull(x, z, preferredRing);
    return sample.waterCoverage;
  }

  sampleFull(x: number, z: number, preferredRing?: number): FarSummarySample {
    const ring = preferredRing ?? 0;

    const tileSample = this.cache.sample(x, z, ring);
    if (tileSample) {
      this._stats.cacheHits++;
      return tileSample;
    }

    if (this.config.sampling.fallbackToLowerRing && ring > 0) {
      for (let ri = ring - 1; ri >= 0; ri--) {
        const fallbackSample = this.cache.sample(x, z, ri);
        if (fallbackSample) {
          this._stats.lowerRingFallbacks++;
          return fallbackSample;
        }
      }
    }

    if (this.config.sampling.fallbackToProcedural) {
      this._stats.proceduralFallbacks++;
      return this.sampleProceduralFallback(x, z);
    }

    this._stats.cacheMisses++;
    return this.sampleConservativeDefault();
  }

  private sampleProceduralFallback(x: number, z: number): FarSummarySample {
    const height = this.terrainSampler.sampleHeight(x, z);
    const ny = 1;

    return {
      heightMin: height,
      heightMax: height,
      heightAvg: height,
      normalX: 0,
      normalY: ny,
      normalZ: 0,
      dominantMaterial: this.terrainSampler.sampleMaterial?.(x, z) ?? 0,
      materialVariance: 0,
      canopyCoverage: this.terrainSampler.sampleCanopyCoverage?.(x, z) ?? 0,
      waterCoverage: this.terrainSampler.sampleWaterCoverage?.(x, z) ?? 0,
      slope: 0,
      roughness: 0,
    };
  }

  private sampleConservativeDefault(): FarSummarySample {
    const h = this.config.sampling.conservativeMissingHeightM;
    return {
      heightMin: h,
      heightMax: h,
      heightAvg: h,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      dominantMaterial: 0,
      materialVariance: 0,
      canopyCoverage: 0,
      waterCoverage: 0,
      slope: 0,
      roughness: 0,
    };
  }
}
