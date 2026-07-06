export interface SelectionCutCacheConfig {
  enabled: boolean;
  cameraCellSizeM: number;
  cameraHeightCellSizeM: number;
  targetCellSizeM: number;
  angleBucketDeg: number;
  thresholdBucketPx: number;
  bubbleCenterCellSizeM: number;
  maxReuseFrames: number;
}

export const DEFAULT_SELECTION_CUT_CACHE_CONFIG: SelectionCutCacheConfig = {
  enabled: true,
  cameraCellSizeM: 1.0,
  cameraHeightCellSizeM: 2.0,
  targetCellSizeM: 1.0,
  angleBucketDeg: 1.0,
  thresholdBucketPx: 0.05,
  bubbleCenterCellSizeM: 1.0,
  maxReuseFrames: 120,
};

export type SelectionCutCacheMissReason =
  | "first_frame"
  | "disabled"
  | "camera_bucket_changed"
  | "settings_changed"
  | "near_field_changed"
  | "stale_revision_changed"
  | "webgpu_error_source_changed"
  | "debug_state_changed"
  | "max_reuse_frames_exceeded"
  | "forced_invalidate";

export interface SelectionCutCacheStats {
  enabled: boolean;
  hits: number;
  misses: number;
  invalidations: number;
  lastReason: SelectionCutCacheMissReason | "hit" | "disabled";
}

export interface SelectionCutCacheKeyInput {
  frameId: number;
  cameraPosition: readonly [number, number, number];
  cameraForward?: readonly [number, number, number];
  selectionCenter: readonly [number, number, number];
  viewportHeight: number;
  fovY: number;
  thresholdPx: number;
  hysteresisMergeFactor: number;
  enforce21: boolean;
  freezeSelection: boolean;
  neighborLevelDeltaMax: number;
  materialTiers: boolean;
  bubbleEnabled: boolean;
  bubbleCenterX: number;
  bubbleCenterZ: number;
  bubbleRadius: number;
  forcedMaxLevel: number | null;
  webgpuSelectionEnabled: boolean;
  webgpuErrorMapGeneration: string | null;
  staleRevision: number;
  debugKey: string;
}

export interface SelectionCutCacheDecision {
  hit: boolean;
  reason: SelectionCutCacheMissReason | "hit" | "disabled";
  key: string;
  debugChanged: boolean;
}

interface KeyParts {
  cameraBucket: string;
  settingsBucket: string;
  nearFieldBucket: string;
  staleRevision: number;
  webgpuBucket: string;
  debugKey: string;
}

function bucket(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.round(value / safeStep);
}

function boolKey(value: boolean): string {
  return value ? "1" : "0";
}

function cameraAngleBucket(
  forward: readonly [number, number, number] | undefined,
  angleBucketDeg: number,
): number {
  if (!forward) return 0;
  const angle = Math.atan2(forward[0], forward[2]) * 180 / Math.PI;
  return bucket(angle, angleBucketDeg);
}

function buildKeyParts(input: SelectionCutCacheKeyInput, config: SelectionCutCacheConfig): KeyParts {
  const cameraBucket = input.freezeSelection
    ? "frozen"
    : [
      bucket(input.cameraPosition[0], config.cameraCellSizeM),
      bucket(input.cameraPosition[1], config.cameraHeightCellSizeM),
      bucket(input.cameraPosition[2], config.cameraCellSizeM),
      cameraAngleBucket(input.cameraForward, config.angleBucketDeg),
      bucket(input.selectionCenter[0], config.targetCellSizeM),
      bucket(input.selectionCenter[1], config.targetCellSizeM),
      bucket(input.selectionCenter[2], config.targetCellSizeM),
    ].join(",");

  const settingsBucket = [
    bucket(input.viewportHeight, 1),
    bucket(input.fovY, 0.0005),
    bucket(input.thresholdPx, config.thresholdBucketPx),
    bucket(input.hysteresisMergeFactor, 0.0005),
    boolKey(input.enforce21),
    boolKey(input.freezeSelection),
    bucket(input.neighborLevelDeltaMax, 1),
    boolKey(input.materialTiers),
    input.forcedMaxLevel ?? "auto",
  ].join(",");

  const nearFieldBucket = input.freezeSelection
    ? "frozen"
    : [
      boolKey(input.bubbleEnabled),
      bucket(input.bubbleCenterX, config.bubbleCenterCellSizeM),
      bucket(input.bubbleCenterZ, config.bubbleCenterCellSizeM),
      bucket(input.bubbleRadius, config.bubbleCenterCellSizeM),
    ].join(",");

  const webgpuBucket = input.freezeSelection
    ? "frozen"
    : [
      boolKey(input.webgpuSelectionEnabled),
      input.webgpuErrorMapGeneration ?? "cpu",
    ].join(",");

  return {
    cameraBucket,
    settingsBucket,
    nearFieldBucket,
    staleRevision: input.staleRevision,
    webgpuBucket,
    debugKey: input.debugKey,
  };
}

function selectionKey(parts: KeyParts): string {
  return [
    `cam:${parts.cameraBucket}`,
    `settings:${parts.settingsBucket}`,
    `near:${parts.nearFieldBucket}`,
    `stale:${parts.staleRevision}`,
    `gpu:${parts.webgpuBucket}`,
  ].join("|");
}

function missReason(prev: KeyParts, next: KeyParts): SelectionCutCacheMissReason {
  if (prev.settingsBucket !== next.settingsBucket) return "settings_changed";
  if (prev.cameraBucket !== next.cameraBucket) return "camera_bucket_changed";
  if (prev.nearFieldBucket !== next.nearFieldBucket) return "near_field_changed";
  if (prev.staleRevision !== next.staleRevision) return "stale_revision_changed";
  if (prev.webgpuBucket !== next.webgpuBucket) return "webgpu_error_source_changed";
  if (prev.debugKey !== next.debugKey) return "debug_state_changed";
  return "settings_changed";
}

export function staleSetSignature(ids: ReadonlySet<string>): string {
  if (ids.size === 0) return "0:";
  return `${ids.size}:${[...ids].sort().join("|")}`;
}

export class SelectionCutCache {
  private lastKey = "";
  private lastParts: KeyParts | null = null;
  private pendingParts: KeyParts | null = null;
  private lastDebugKey = "";
  private lastCommitFrame = -1;
  private forceInvalidateReason: SelectionCutCacheMissReason | null = null;
  private hitCount = 0;
  private missCount = 0;
  private invalidationCount = 0;
  private lastDecisionReason: SelectionCutCacheStats["lastReason"];

  constructor(private readonly config: SelectionCutCacheConfig) {
    this.lastDecisionReason = config.enabled ? "first_frame" : "disabled";
  }

  decide(input: SelectionCutCacheKeyInput): SelectionCutCacheDecision {
    if (!this.config.enabled) {
      this.lastDecisionReason = "disabled";
      return { hit: false, reason: "disabled", key: "", debugChanged: false };
    }

    const parts = buildKeyParts(input, this.config);
    const key = selectionKey(parts);
    this.pendingParts = parts;
    const debugChanged = this.lastDebugKey !== "" && this.lastDebugKey !== parts.debugKey;

    if (this.forceInvalidateReason) {
      const reason = this.forceInvalidateReason;
      this.forceInvalidateReason = null;
      this.missCount++;
      this.lastDecisionReason = reason;
      return { hit: false, reason, key, debugChanged };
    }

    if (!this.lastParts || this.lastKey === "") {
      this.missCount++;
      this.lastDecisionReason = "first_frame";
      return { hit: false, reason: "first_frame", key, debugChanged };
    }

    if (!input.freezeSelection && input.frameId - this.lastCommitFrame > this.config.maxReuseFrames) {
      this.missCount++;
      this.lastDecisionReason = "max_reuse_frames_exceeded";
      return { hit: false, reason: "max_reuse_frames_exceeded", key, debugChanged };
    }

    if (key !== this.lastKey) {
      const reason = missReason(this.lastParts, parts);
      this.missCount++;
      this.lastDecisionReason = reason;
      return { hit: false, reason, key, debugChanged };
    }

    this.hitCount++;
    this.lastDecisionReason = "hit";
    this.lastDebugKey = parts.debugKey;
    return { hit: true, reason: "hit", key, debugChanged };
  }

  commitMiss(key: string, frameId: number): void {
    if (!this.config.enabled) return;
    const pendingParts = this.pendingParts;
    this.pendingParts = null;
    if (!pendingParts) return;
    const pendingKey = selectionKey(pendingParts);
    if (pendingKey !== key) return;
    this.lastKey = key;
    this.lastParts = pendingParts;
    this.lastDebugKey = pendingParts.debugKey;
    this.lastCommitFrame = frameId;
  }

  commit(input: SelectionCutCacheKeyInput, frameId: number): void {
    if (!this.config.enabled) return;
    const parts = buildKeyParts(input, this.config);
    this.lastParts = parts;
    this.lastKey = selectionKey(parts);
    this.lastDebugKey = parts.debugKey;
    this.lastCommitFrame = frameId;
    this.pendingParts = null;
  }

  invalidate(reason: SelectionCutCacheMissReason = "forced_invalidate"): void {
    this.lastKey = "";
    this.lastParts = null;
    this.lastDebugKey = "";
    this.lastCommitFrame = -1;
    this.forceInvalidateReason = reason;
    this.pendingParts = null;
    this.invalidationCount++;
    this.lastDecisionReason = reason;
  }

  stats(): SelectionCutCacheStats {
    return {
      enabled: this.config.enabled,
      hits: this.hitCount,
      misses: this.missCount,
      invalidations: this.invalidationCount,
      lastReason: this.lastDecisionReason,
    };
  }
}
