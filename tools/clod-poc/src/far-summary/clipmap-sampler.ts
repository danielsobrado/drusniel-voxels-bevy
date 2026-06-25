import * as THREE from "three";
import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryCache, FallbackStatsWriter } from "./summary-cache.js";
import type { FarSummarySample } from "./types.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { computeNormalFiniteDifference } from "./summary-tile-builder.js";

export interface FarHeightProvider {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
  sampleMaterial?(x: number, z: number): number;
}

export class FarSummaryClipmapSampler implements FarHeightProvider {
  private readonly cache: FarSummaryCache;
  private readonly config: FarSummaryConfig;
  private readonly terrainSampler: FarTerrainSampler;
  private readonly _fallbacks: FallbackStatsWriter;

  constructor(
    cache: FarSummaryCache,
    config: FarSummaryConfig,
    terrainSampler: FarTerrainSampler,
    fallbackStats?: FallbackStatsWriter,
  ) {
    this.cache = cache;
    this.config = config;
    this.terrainSampler = terrainSampler;
    this._fallbacks = fallbackStats ?? cache;
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

    const tileSample = this.cache.sampleExactRing(x, z, ring);
    if (tileSample) {
      return tileSample;
    }

    // Fall back to coarser rings (higher index = larger cells = wider coverage).
    // Finer rings (lower index) have smaller cells and won't cover a position that ring
    // `ring` already missed, so we iterate upward through ring indices.
    if (this.config.sampling.fallbackToLowerRing) {
      for (let ri = ring + 1; ri < this.config.rings.length; ri++) {
        const fallbackSample = this.cache.sampleExactRing(x, z, ri);
        if (fallbackSample) {
          this._fallbacks.countLowerRingFallback();
          return fallbackSample;
        }
      }
    }

    if (this.config.sampling.fallbackToProcedural) {
      this._fallbacks.countProceduralFallback();
      return this.sampleProceduralFallback(x, z);
    }

    return this.sampleConservativeDefault();
  }

  private sampleProceduralFallback(x: number, z: number): FarSummarySample {
    const height = this.terrainSampler.sampleHeight(x, z);
    const step = this.config.sampling.normalSampleStepCells * 16;
    const [nx, ny, nz] = computeNormalFiniteDifference(
      (px, pz) => this.terrainSampler.sampleHeight(px, pz),
      x, z, step,
    );

    return {
      heightMin: height,
      heightMax: height,
      heightAvg: height,
      normalX: nx,
      normalY: ny,
      normalZ: nz,
      dominantMaterial: this.terrainSampler.sampleMaterial?.(x, z) ?? 0,
      materialVariance: 0,
      canopyCoverage: this.terrainSampler.sampleCanopyCoverage?.(x, z) ?? 0,
      waterCoverage: this.terrainSampler.sampleWaterCoverage?.(x, z) ?? 0,
      slope: Math.acos(Math.max(0, Math.min(1, ny))),
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
