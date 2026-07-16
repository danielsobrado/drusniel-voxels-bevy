const SAMPLE_WINDOW = 120;

export type ConstructionTimingName = "previewTotal" | "targeting" | "snapQuery" | "placementValidation";

export interface ConstructionTimingSummary {
  lastMs: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
  samples: number;
}

export interface ConstructionPerformanceSnapshot {
  previewTotal: ConstructionTimingSummary;
  targeting: ConstructionTimingSummary;
  snapQuery: ConstructionTimingSummary;
  placementValidation: ConstructionTimingSummary;
  snapVisitedCells: number;
  snapCandidatePoints: number;
  snapTraversalTruncated: boolean;
  overlapVisitedCells: number;
  overlapCandidatePieces: number;
  terrainConformRequests: number;
  clodInvalidationRequests: number;
}

function emptySummary(): ConstructionTimingSummary {
  return { lastMs: 0, averageMs: 0, p95Ms: 0, maxMs: 0, samples: 0 };
}

function summarize(samples: readonly number[]): ConstructionTimingSummary {
  if (samples.length === 0) return emptySummary();
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    lastMs: samples[samples.length - 1] ?? 0,
    averageMs: total / samples.length,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    samples: samples.length,
  };
}

export class ConstructionPerformanceTracker {
  private readonly samples: Record<ConstructionTimingName, number[]> = {
    previewTotal: [],
    targeting: [],
    snapQuery: [],
    placementValidation: [],
  };
  private snapVisitedCells = 0;
  private snapCandidatePoints = 0;
  private snapTraversalTruncated = false;
  private overlapVisitedCells = 0;
  private overlapCandidatePieces = 0;
  private terrainConformRequests = 0;
  private clodInvalidationRequests = 0;

  measure<T>(name: ConstructionTimingName, operation: () => T): T {
    const started = performance.now();
    try {
      return operation();
    } finally {
      this.record(name, performance.now() - started);
    }
  }

  setSnapQueryStats(visitedCells: number, candidatePoints: number, truncated: boolean): void {
    this.snapVisitedCells = visitedCells;
    this.snapCandidatePoints = candidatePoints;
    this.snapTraversalTruncated = truncated;
  }

  setOverlapQueryStats(visitedCells: number, candidatePieces: number): void {
    this.overlapVisitedCells = visitedCells;
    this.overlapCandidatePieces = candidatePieces;
  }

  recordTerrainConformRequest(): void {
    this.terrainConformRequests += 1;
    this.clodInvalidationRequests += 1;
  }

  snapshot(): ConstructionPerformanceSnapshot {
    return {
      previewTotal: summarize(this.samples.previewTotal),
      targeting: summarize(this.samples.targeting),
      snapQuery: summarize(this.samples.snapQuery),
      placementValidation: summarize(this.samples.placementValidation),
      snapVisitedCells: this.snapVisitedCells,
      snapCandidatePoints: this.snapCandidatePoints,
      snapTraversalTruncated: this.snapTraversalTruncated,
      overlapVisitedCells: this.overlapVisitedCells,
      overlapCandidatePieces: this.overlapCandidatePieces,
      terrainConformRequests: this.terrainConformRequests,
      clodInvalidationRequests: this.clodInvalidationRequests,
    };
  }

  private record(name: ConstructionTimingName, elapsedMs: number): void {
    const values = this.samples[name];
    values.push(Math.max(0, elapsedMs));
    if (values.length > SAMPLE_WINDOW) values.splice(0, values.length - SAMPLE_WINDOW);
  }
}
