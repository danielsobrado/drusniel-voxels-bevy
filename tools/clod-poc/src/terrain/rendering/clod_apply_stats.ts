export interface ClodApplyStatsSnapshot {
  clodWorkerRebuildMs: number;
  clodApplyTotalMs: number;
  clodApplyGeometryMs: number;
  clodApplyMaterialMs: number;
  clodApplyColliderMs: number;
  clodApplyNodes: number;
  clodApplyTriangles: number;
  clodApplyQueueDepth: number;
  clodColliderQueueDepth: number;
  clodStaleVisibleNodes: number;
  clodApplyBudgetExceeded: number;
  clodColliderApplyMs: number;
  clodColliderJobsApplied: number;
  clodColliderPriorityOverrides: number;
  clodColliderStaleFramesMax: number;
  clodGeometryReusedOnApply: number;
}

export function emptyClodApplyStatsSnapshot(): ClodApplyStatsSnapshot {
  return {
    clodWorkerRebuildMs: 0,
    clodApplyTotalMs: 0,
    clodApplyGeometryMs: 0,
    clodApplyMaterialMs: 0,
    clodApplyColliderMs: 0,
    clodApplyNodes: 0,
    clodApplyTriangles: 0,
    clodApplyQueueDepth: 0,
    clodColliderQueueDepth: 0,
    clodStaleVisibleNodes: 0,
    clodApplyBudgetExceeded: 0,
    clodColliderApplyMs: 0,
    clodColliderJobsApplied: 0,
    clodColliderPriorityOverrides: 0,
    clodColliderStaleFramesMax: 0,
    clodGeometryReusedOnApply: 0,
  };
}

export class ClodApplyStats {
  private readonly frame = emptyClodApplyStatsSnapshot();
  private workerRebuildMs = 0;
  private budgetExceededFrames = 0;
  private colliderPriorityOverrides = 0;
  private colliderStaleFramesMax = 0;
  private geometryReusedOnApply = 0;

  beginFrame(): void {
    const queueDepth = this.frame.clodApplyQueueDepth;
    const colliderQueueDepth = this.frame.clodColliderQueueDepth;
    const staleVisible = this.frame.clodStaleVisibleNodes;
    Object.assign(this.frame, emptyClodApplyStatsSnapshot());
    this.frame.clodWorkerRebuildMs = this.workerRebuildMs;
    this.workerRebuildMs = 0;
    this.frame.clodApplyQueueDepth = queueDepth;
    this.frame.clodColliderQueueDepth = colliderQueueDepth;
    this.frame.clodStaleVisibleNodes = staleVisible;
    this.frame.clodApplyBudgetExceeded = this.budgetExceededFrames;
    this.frame.clodColliderPriorityOverrides = this.colliderPriorityOverrides;
    this.frame.clodColliderStaleFramesMax = this.colliderStaleFramesMax;
    this.frame.clodGeometryReusedOnApply = this.geometryReusedOnApply;
  }

  recordWorkerRebuild(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.workerRebuildMs += ms;
  }

  recordGeometry(ms: number, triangles: number, reused: boolean, applied: boolean): void {
    this.frame.clodApplyGeometryMs += Math.max(0, ms);
    if (applied) {
      this.frame.clodApplyNodes++;
      this.frame.clodApplyTriangles += Math.max(0, triangles);
    }
    if (reused) {
      this.geometryReusedOnApply++;
      this.frame.clodGeometryReusedOnApply = this.geometryReusedOnApply;
    }
  }

  recordMaterial(ms: number): void {
    this.frame.clodApplyMaterialMs += Math.max(0, ms);
  }

  recordCollider(ms: number): void {
    const safeMs = Math.max(0, ms);
    this.frame.clodApplyColliderMs += safeMs;
    this.frame.clodColliderApplyMs += safeMs;
    this.frame.clodColliderJobsApplied++;
  }

  recordBudgetExceeded(): void {
    this.budgetExceededFrames++;
    this.frame.clodApplyBudgetExceeded = this.budgetExceededFrames;
  }

  recordColliderPriorityOverride(): void {
    this.colliderPriorityOverrides++;
    this.frame.clodColliderPriorityOverrides = this.colliderPriorityOverrides;
  }

  recordColliderStaleFrames(frames: number): void {
    this.colliderStaleFramesMax = Math.max(this.colliderStaleFramesMax, Math.max(0, frames));
    this.frame.clodColliderStaleFramesMax = this.colliderStaleFramesMax;
  }

  setQueueDepths(geometryDepth: number, colliderDepth: number, staleVisibleNodes: number): void {
    this.frame.clodApplyQueueDepth = Math.max(0, geometryDepth);
    this.frame.clodColliderQueueDepth = Math.max(0, colliderDepth);
    this.frame.clodStaleVisibleNodes = Math.max(0, staleVisibleNodes);
  }

  finishFrame(totalMs: number): void {
    this.frame.clodApplyTotalMs = Math.max(0, totalMs);
  }

  snapshot(): ClodApplyStatsSnapshot {
    return { ...this.frame };
  }
}
