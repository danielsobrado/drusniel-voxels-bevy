import {
  ENVIRONMENT_QUERY_FIELD_NAMES,
  ENVIRONMENT_QUERY_SOURCE_NAMES,
} from "./constants.js";
import type {
  EnvironmentQueryField,
  EnvironmentQueryMeta,
  EnvironmentQuerySource,
} from "./types.js";

export interface EnvironmentQueryDiagnosticsSnapshot {
  readonly scalarCalls: number;
  readonly batchCalls: number;
  readonly samples: number;
  readonly invalid: number;
  readonly fallback: number;
  readonly minHintM: number;
  readonly maxHintM: number;
  readonly maxBatchSize: number;
  readonly timeMs: number;
  readonly bySource: Readonly<Record<EnvironmentQuerySource, number>>;
  readonly byField: Readonly<Record<EnvironmentQueryField, number>>;
}

export class EnvironmentQueryDiagnostics {
  private scalarCalls = 0;
  private batchCalls = 0;
  private samples = 0;
  private invalid = 0;
  private fallback = 0;
  private minHintM = Number.POSITIVE_INFINITY;
  private maxHintM = 0;
  private maxBatchSize = 0;
  private timeMs = 0;
  private readonly sourceCounts = new Uint32Array(ENVIRONMENT_QUERY_SOURCE_NAMES.length);
  private readonly fieldCounts = new Uint32Array(ENVIRONMENT_QUERY_FIELD_NAMES.length);

  recordScalar(field: EnvironmentQueryField, meta: EnvironmentQueryMeta, elapsedMs = 0): void {
    this.scalarCalls += 1;
    this.samples += 1;
    this.recordField(field, 1);
    this.recordMeta(meta, 1);
    this.recordTime(elapsedMs);
  }

  recordBatch(
    fieldMask: number,
    count: number,
    sampleHintM: number,
    elapsedMs = 0,
  ): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Environment diagnostics batch count must be a non-negative integer, received ${count}`);
    }

    this.batchCalls += 1;
    this.samples += count;
    this.maxBatchSize = Math.max(this.maxBatchSize, count);
    this.recordHint(sampleHintM);
    this.recordTime(elapsedMs);

    for (let index = 0; index < ENVIRONMENT_QUERY_FIELD_NAMES.length; index++) {
      if ((fieldMask & (1 << index)) !== 0) {
        this.fieldCounts[index] = (this.fieldCounts[index] ?? 0) + count;
      }
    }
  }

  recordBatchSource(source: EnvironmentQuerySource, count: number, valid = true): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Environment diagnostics source count must be a non-negative integer, received ${count}`);
    }

    const sourceIndex = ENVIRONMENT_QUERY_SOURCE_NAMES.indexOf(source);
    if (sourceIndex < 0) throw new Error(`Unknown environment query source: ${source}`);
    this.sourceCounts[sourceIndex] = (this.sourceCounts[sourceIndex] ?? 0) + count;
    if (!valid) this.invalid += count;
    if (source === "fallback") this.fallback += count;
  }

  snapshot(): EnvironmentQueryDiagnosticsSnapshot {
    return {
      scalarCalls: this.scalarCalls,
      batchCalls: this.batchCalls,
      samples: this.samples,
      invalid: this.invalid,
      fallback: this.fallback,
      minHintM: Number.isFinite(this.minHintM) ? this.minHintM : 0,
      maxHintM: this.maxHintM,
      maxBatchSize: this.maxBatchSize,
      timeMs: this.timeMs,
      bySource: this.toSourceRecord(),
      byField: this.toFieldRecord(),
    };
  }

  reset(): void {
    this.scalarCalls = 0;
    this.batchCalls = 0;
    this.samples = 0;
    this.invalid = 0;
    this.fallback = 0;
    this.minHintM = Number.POSITIVE_INFINITY;
    this.maxHintM = 0;
    this.maxBatchSize = 0;
    this.timeMs = 0;
    this.sourceCounts.fill(0);
    this.fieldCounts.fill(0);
  }

  private recordMeta(meta: EnvironmentQueryMeta, count: number): void {
    this.recordBatchSource(meta.source, count, meta.valid);
    this.recordHint(meta.cellSizeM);
  }

  private recordField(field: EnvironmentQueryField, count: number): void {
    const fieldIndex = ENVIRONMENT_QUERY_FIELD_NAMES.indexOf(field);
    if (fieldIndex < 0) throw new Error(`Unknown environment query field: ${field}`);
    this.fieldCounts[fieldIndex] = (this.fieldCounts[fieldIndex] ?? 0) + count;
  }

  private recordHint(hintM: number): void {
    if (!Number.isFinite(hintM) || hintM <= 0) return;
    this.minHintM = Math.min(this.minHintM, hintM);
    this.maxHintM = Math.max(this.maxHintM, hintM);
  }

  private recordTime(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    this.timeMs += elapsedMs;
  }

  private toSourceRecord(): Record<EnvironmentQuerySource, number> {
    return Object.fromEntries(
      ENVIRONMENT_QUERY_SOURCE_NAMES.map((source, index) => [source, this.sourceCounts[index] ?? 0]),
    ) as Record<EnvironmentQuerySource, number>;
  }

  private toFieldRecord(): Record<EnvironmentQueryField, number> {
    return Object.fromEntries(
      ENVIRONMENT_QUERY_FIELD_NAMES.map((field, index) => [field, this.fieldCounts[index] ?? 0]),
    ) as Record<EnvironmentQueryField, number>;
  }
}
