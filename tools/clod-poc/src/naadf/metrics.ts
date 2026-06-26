export class RollingMetric {
  private readonly values: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 256) {
    this.maxSamples = maxSamples;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.values.push(value);
    if (this.values.length > this.maxSamples) {
      this.values.shift();
    }
  }

  average(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
    return sorted[idx]!;
  }

  max(): number {
    if (this.values.length === 0) return 0;
    return Math.max(...this.values);
  }

  reset(): void {
    this.values.length = 0;
  }
}

export type NaadfPocMetricsSnapshot = Readonly<{
  frame: number;
  residentChunks: number;
  residentFarTiles: number;
  queuedJobs: number;
  buildingJobs: number;
  committedJobs: number;
  evictedEntries: number;
  nearTableHits: number;
  hashFallbackHits: number;
  farClipmapHits: number;
  missingSamples: number;
  hashInsertFailures: number;
  unknownSunSamples: number;
  primaryStepsP50: number;
  primaryStepsP95: number;
  sunStepsP50: number;
  sunStepsP95: number;
  aadfSkips: number;
  visibleHoles: number;
  farShellSamples: number;
  farShellMissingSamples: number;
  canopySamples: number;
  shadowProxySamples: number;
}>;

export class NaadfMetricsCollector {
  readonly primarySteps = new RollingMetric();
  readonly sunSteps = new RollingMetric();
  frame = 0;
  residentChunks = 0;
  residentFarTiles = 0;
  queuedJobs = 0;
  buildingJobs = 0;
  committedJobs = 0;
  evictedEntries = 0;
  nearTableHits = 0;
  hashFallbackHits = 0;
  farClipmapHits = 0;
  missingSamples = 0;
  unknownSunSamples = 0;
  aadfSkips = 0;
  visibleHoles = 0;
  farShellSamples = 0;
  farShellMissingSamples = 0;
  canopySamples = 0;
  shadowProxySamples = 0;
  hashInsertFailures = 0;

  beginFrame(): void {
    this.frame++;
    this.committedJobs = 0;
    this.evictedEntries = 0;
    this.nearTableHits = 0;
    this.hashFallbackHits = 0;
    this.farClipmapHits = 0;
    this.missingSamples = 0;
    this.unknownSunSamples = 0;
    this.aadfSkips = 0;
    this.farShellSamples = 0;
    this.farShellMissingSamples = 0;
    this.canopySamples = 0;
    this.shadowProxySamples = 0;
  }

  snapshot(): NaadfPocMetricsSnapshot {
    return {
      frame: this.frame,
      residentChunks: this.residentChunks,
      residentFarTiles: this.residentFarTiles,
      queuedJobs: this.queuedJobs,
      buildingJobs: this.buildingJobs,
      committedJobs: this.committedJobs,
      evictedEntries: this.evictedEntries,
      nearTableHits: this.nearTableHits,
      hashFallbackHits: this.hashFallbackHits,
      farClipmapHits: this.farClipmapHits,
      missingSamples: this.missingSamples,
      unknownSunSamples: this.unknownSunSamples,
      primaryStepsP50: this.primarySteps.percentile(0.5),
      primaryStepsP95: this.primarySteps.percentile(0.95),
      sunStepsP50: this.sunSteps.percentile(0.5),
      sunStepsP95: this.sunSteps.percentile(0.95),
      aadfSkips: this.aadfSkips,
      visibleHoles: this.visibleHoles,
      farShellSamples: this.farShellSamples,
      farShellMissingSamples: this.farShellMissingSamples,
      canopySamples: this.canopySamples,
      shadowProxySamples: this.shadowProxySamples,
      hashInsertFailures: this.hashInsertFailures,
    };
  }

  toCounters(): Record<string, number> {
    const s = this.snapshot();
    return {
      naadf_resident_chunks: s.residentChunks,
      naadf_resident_far_tiles: s.residentFarTiles,
      naadf_queued_jobs: s.queuedJobs,
      naadf_building_jobs: s.buildingJobs,
      naadf_committed_jobs: s.committedJobs,
      naadf_evicted_entries: s.evictedEntries,
      naadf_near_table_hits: s.nearTableHits,
      naadf_hash_fallback_hits: s.hashFallbackHits,
      naadf_far_clipmap_hits: s.farClipmapHits,
      naadf_missing_samples: s.missingSamples,
      naadf_unknown_sun_samples: s.unknownSunSamples,
      naadf_primary_steps_p95: s.primaryStepsP95,
      naadf_sun_steps_p95: s.sunStepsP95,
      naadf_aadf_skips: s.aadfSkips,
      naadf_visible_holes: s.visibleHoles,
      naadf_far_shell_samples: s.farShellSamples,
      naadf_far_shell_missing: s.farShellMissingSamples,
      naadf_canopy_samples: s.canopySamples,
      naadf_shadow_proxy_samples: s.shadowProxySamples,
      naadf_hash_insert_failures: s.hashInsertFailures,
    };
  }
}
