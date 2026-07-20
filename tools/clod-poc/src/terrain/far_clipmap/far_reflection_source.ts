import type { LargePropOcclusionHeightPayload } from "../../props/large_prop_occlusion_height.js";
import type { FarHeightProviderSample } from "../../far-summary/clipmap-sampler.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

export interface FarReflectionSourceConfig {
  readonly enabled: boolean;
  readonly resolution: number;
  readonly spanM: number;
  readonly snapM: number;
  readonly buildCellsPerFrame: number;
}

export interface FarReflectionSourceSnapshot {
  readonly enabled: boolean;
  readonly generation: number;
  readonly sourceRevision: number;
  readonly propGeneration: number;
  readonly propRevision: number;
  readonly resolution: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSizeM: number;
  /** vec4 per cell: topY, terrainValid, propPresent, overallValid. */
  readonly data: Float32Array;
}

export interface FarReflectionSourceStats {
  readonly activeGeneration: number;
  readonly activeSourceRevision: number;
  readonly activePropRevision: number;
  readonly pending: boolean;
  readonly pendingCells: number;
  readonly processedCellsLastStep: number;
  readonly fallbackSamplesTotal: number;
  readonly exceptionSamplesTotal: number;
  readonly swaps: number;
}

export interface FarReflectionSourceSubmitInput {
  readonly source: FarClipmapSource;
  readonly sourceRevision: number;
  readonly propGeneration: number;
  readonly propPayload: LargePropOcclusionHeightPayload | null;
  readonly centerX: number;
  readonly centerZ: number;
}

interface PendingBuild {
  readonly key: string;
  readonly source: FarClipmapSource;
  readonly sourceRevision: number;
  readonly propGeneration: number;
  readonly propRevision: number;
  readonly resolution: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSizeM: number;
  readonly data: Float32Array;
  readonly propTopAt: (x: number, z: number) => number;
  cursor: number;
  fallbackSamples: number;
  exceptionSamples: number;
}

const CELL_STRIDE = 4;
const CHANNEL_TOP_Y = 0;
const CHANNEL_TERRAIN_VALID = 1;
const CHANNEL_PROP_PRESENT = 2;
const CHANNEL_VALID = 3;

export class FarReflectionSource {
  private active = emptySnapshot();
  private pending: PendingBuild | null = null;
  private submittedKey = "";
  private processedCellsLastStep = 0;
  private fallbackSamplesTotal = 0;
  private exceptionSamplesTotal = 0;
  private swaps = 0;

  constructor(private readonly config: FarReflectionSourceConfig) {}

  submit(input: FarReflectionSourceSubmitInput): boolean {
    const geometry = resolveGeometry(this.config, input.centerX, input.centerZ);
    const propRevision = input.propPayload?.revision ?? 0;
    const key = [
      this.config.enabled ? 1 : 0,
      input.sourceRevision,
      input.propGeneration,
      propRevision,
      geometry.resolution,
      geometry.originX,
      geometry.originZ,
      geometry.cellSizeM,
    ].join("|");
    if (key === this.submittedKey) return false;
    this.submittedKey = key;

    if (!this.config.enabled) {
      this.pending = null;
      this.active = {
        ...emptySnapshot(),
        generation: this.active.generation + 1,
        sourceRevision: finiteRevision(input.sourceRevision),
        propGeneration: finiteRevision(input.propGeneration),
        propRevision: finiteRevision(propRevision),
      };
      this.processedCellsLastStep = 0;
      this.swaps += 1;
      return true;
    }

    this.pending = {
      key,
      source: input.source,
      sourceRevision: finiteRevision(input.sourceRevision),
      propGeneration: finiteRevision(input.propGeneration),
      propRevision: finiteRevision(propRevision),
      resolution: geometry.resolution,
      originX: geometry.originX,
      originZ: geometry.originZ,
      cellSizeM: geometry.cellSizeM,
      data: new Float32Array(geometry.resolution * geometry.resolution * CELL_STRIDE),
      propTopAt: createPropTopLookup(input.propPayload),
      cursor: 0,
      fallbackSamples: 0,
      exceptionSamples: 0,
    };
    this.processedCellsLastStep = 0;
    return true;
  }

  step(maxCells = this.config.buildCellsPerFrame): boolean {
    const pending = this.pending;
    this.processedCellsLastStep = 0;
    if (!pending) return false;

    const total = pending.resolution * pending.resolution;
    let budget = positiveInteger(maxCells, 1);
    const summary = createSummaryScratch();
    while (pending.cursor < total && budget > 0 && this.pending === pending) {
      this.buildCell(pending, pending.cursor, summary);
      pending.cursor += 1;
      this.processedCellsLastStep += 1;
      budget -= 1;
    }
    if (this.pending === pending && pending.cursor >= total) this.commit(pending);
    return this.processedCellsLastStep > 0;
  }

  snapshot(): FarReflectionSourceSnapshot {
    return this.active;
  }

  stats(): FarReflectionSourceStats {
    return {
      activeGeneration: this.active.generation,
      activeSourceRevision: this.active.sourceRevision,
      activePropRevision: this.active.propRevision,
      pending: this.pending !== null,
      pendingCells: this.pending?.cursor ?? 0,
      processedCellsLastStep: this.processedCellsLastStep,
      fallbackSamplesTotal: this.fallbackSamplesTotal,
      exceptionSamplesTotal: this.exceptionSamplesTotal,
      swaps: this.swaps,
    };
  }

  private buildCell(pending: PendingBuild, index: number, summary: FarHeightProviderSample): void {
    const cellX = index % pending.resolution;
    const cellZ = Math.floor(index / pending.resolution);
    const x = pending.originX + cellX * pending.cellSizeM;
    const z = pending.originZ + cellZ * pending.cellSizeM;
    const centerX = pending.originX + pending.cellSizeM * (pending.resolution - 1) * 0.5;
    const centerZ = pending.originZ + pending.cellSizeM * (pending.resolution - 1) * 0.5;
    const distanceM = Math.hypot(x - centerX, z - centerZ);

    let terrainHeight = Number.NaN;
    try {
      resetSummaryScratch(summary);
      const hasSummary = pending.source.sampleSummaryInto?.(x, z, distanceM, summary) === true;
      if (hasSummary) terrainHeight = summary.height;
      else {
        pending.fallbackSamples += 1;
        terrainHeight = pending.source.sampleHeight(x, z);
      }
    } catch {
      pending.exceptionSamples += 1;
    }

    const propTop = pending.propTopAt(x, z);
    const terrainValid = Number.isFinite(terrainHeight);
    const propPresent = Number.isFinite(propTop);
    const topY = terrainValid && propPresent
      ? Math.max(terrainHeight, propTop)
      : terrainValid
        ? terrainHeight
        : propPresent
          ? propTop
          : 0;
    const offset = index * CELL_STRIDE;
    pending.data[offset + CHANNEL_TOP_Y] = topY;
    pending.data[offset + CHANNEL_TERRAIN_VALID] = terrainValid ? 1 : 0;
    pending.data[offset + CHANNEL_PROP_PRESENT] = propPresent ? 1 : 0;
    pending.data[offset + CHANNEL_VALID] = terrainValid || propPresent ? 1 : 0;
  }

  private commit(pending: PendingBuild): void {
    if (this.pending !== pending) return;
    this.active = {
      enabled: true,
      generation: this.active.generation + 1,
      sourceRevision: pending.sourceRevision,
      propGeneration: pending.propGeneration,
      propRevision: pending.propRevision,
      resolution: pending.resolution,
      originX: pending.originX,
      originZ: pending.originZ,
      cellSizeM: pending.cellSizeM,
      data: pending.data,
    };
    this.pending = null;
    this.fallbackSamplesTotal += pending.fallbackSamples;
    this.exceptionSamplesTotal += pending.exceptionSamples;
    this.swaps += 1;
  }
}

function resolveGeometry(config: FarReflectionSourceConfig, centerX: number, centerZ: number) {
  const resolution = Math.max(2, positiveInteger(config.resolution, 2));
  const spanM = positiveFinite(config.spanM, resolution - 1);
  const cellSizeM = spanM / (resolution - 1);
  const snapM = positiveFinite(config.snapM, cellSizeM);
  const snappedX = Math.floor(finiteOr(centerX, 0) / snapM) * snapM;
  const snappedZ = Math.floor(finiteOr(centerZ, 0) / snapM) * snapM;
  return {
    resolution,
    cellSizeM,
    originX: snappedX - spanM * 0.5,
    originZ: snappedZ - spanM * 0.5,
  };
}

function createPropTopLookup(payload: LargePropOcclusionHeightPayload | null): (x: number, z: number) => number {
  if (!payload || payload.cellSizeM <= 0 || payload.cellX.length === 0) return () => Number.NaN;
  const rows = new Map<number, Map<number, number>>();
  const count = Math.min(payload.cellX.length, payload.cellZ.length, payload.topY.length);
  for (let index = 0; index < count; index += 1) {
    const cellX = payload.cellX[index]!;
    const cellZ = payload.cellZ[index]!;
    const topY = payload.topY[index]!;
    if (!Number.isFinite(topY)) continue;
    let row = rows.get(cellZ);
    if (!row) {
      row = new Map();
      rows.set(cellZ, row);
    }
    row.set(cellX, Math.max(row.get(cellX) ?? Number.NEGATIVE_INFINITY, topY));
  }
  const cellSizeM = payload.cellSizeM;
  return (x: number, z: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return Number.NaN;
    return rows.get(Math.floor(z / cellSizeM))?.get(Math.floor(x / cellSizeM)) ?? Number.NaN;
  };
}

function emptySnapshot(): FarReflectionSourceSnapshot {
  return {
    enabled: false,
    generation: 0,
    sourceRevision: 0,
    propGeneration: 0,
    propRevision: 0,
    resolution: 0,
    originX: 0,
    originZ: 0,
    cellSizeM: 0,
    data: new Float32Array(0),
  };
}

function createSummaryScratch(): FarHeightProviderSample {
  return { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0 };
}

function resetSummaryScratch(out: FarHeightProviderSample): void {
  out.height = 0;
  out.normalX = 0;
  out.normalY = 1;
  out.normalZ = 0;
  out.material = 0;
}

function finiteRevision(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function positiveInteger(value: number, fallback: number): number {
  return Math.max(1, Math.floor(positiveFinite(value, fallback)));
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
