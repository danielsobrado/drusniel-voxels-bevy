import type { ClodPageNode } from "../../types.js";
import { triangleCount } from "../../types.js";
import { ClodApplyStats, type ClodApplyStatsSnapshot } from "./clod_apply_stats.js";

export interface ClodApplyBudget {
  enabled: boolean;
  maxApplyMsPerFrame: number;
  maxGeometryJobsPerFrame: number;
  maxColliderJobsPerFrame: number;
  keepStaleVisible: boolean;
  prioritizeLod0: boolean;
  prioritizeNearCamera: boolean;
  colliderMaxDelayFrames: number;
  debugLogSpikes: boolean;
  spikeLogThresholdMs: number;
}

export const DEFAULT_CLOD_APPLY_BUDGET: ClodApplyBudget = {
  enabled: true,
  maxApplyMsPerFrame: 1.0,
  maxGeometryJobsPerFrame: 2,
  maxColliderJobsPerFrame: 1,
  keepStaleVisible: true,
  prioritizeLod0: true,
  prioritizeNearCamera: true,
  colliderMaxDelayFrames: 8,
  debugLogSpikes: false,
  spikeLogThresholdMs: 2.0,
};

export interface ClodGeometryApplyResult {
  applied?: boolean;
  geometryMs: number;
  materialMs: number;
  triangles: number;
  reusedGeometry: boolean;
}

export type ClodApplyFailureKind = "geometry" | "collider";

export interface ClodApplyQueueDeps {
  budget: ClodApplyBudget;
  applyGeometry: (node: ClodPageNode) => ClodGeometryApplyResult;
  applyCollider: (node: ClodPageNode) => number;
  getFrameId: () => number;
  getCameraPosition: () => { x: number; z: number };
  isNodeVisible: (nodeId: string) => boolean;
  onGeometryApplied?: (node: ClodPageNode) => void;
  onApplyFailed?: (kind: ClodApplyFailureKind, node: ClodPageNode, error: unknown) => void;
}

interface ClodApplyJob {
  node: ClodPageNode;
  sequence: number;
  enqueuedFrame: number;
}

interface ClodColliderJob extends ClodApplyJob {
  priorityOverride: boolean;
}

function removeNodeJob<T extends ClodApplyJob>(jobs: T[], nodeId: string): void {
  const index = jobs.findIndex((job) => job.node.id === nodeId);
  if (index >= 0) jobs.splice(index, 1);
}

function geometryApplied(result: ClodGeometryApplyResult): boolean {
  return result.applied !== false;
}

export class ClodApplyQueue {
  private readonly deps: ClodApplyQueueDeps;
  private readonly geometryJobs: ClodApplyJob[] = [];
  private readonly colliderJobs: ClodColliderJob[] = [];
  private readonly statsRecorder = new ClodApplyStats();
  private nextSequence = 1;

  constructor(deps: ClodApplyQueueDeps) {
    this.deps = deps;
  }

  enqueueNodes(nodes: readonly ClodPageNode[]): void {
    for (const node of nodes) this.enqueueGeometry(node);
    this.updateDepthStats();
  }

  recordWorkerRebuild(ms: number): void {
    this.statsRecorder.recordWorkerRebuild(ms);
  }

  drain(): ClodApplyStatsSnapshot {
    const budget = this.deps.budget;
    this.statsRecorder.beginFrame();
    this.sortGeometryJobs();
    this.sortColliderJobs();

    const startedAt = performance.now();
    const maxMs = budget.enabled ? budget.maxApplyMsPerFrame : Number.POSITIVE_INFINITY;
    const maxGeometryJobs = budget.enabled ? budget.maxGeometryJobsPerFrame : Number.POSITIVE_INFINITY;
    const maxColliderJobs = budget.enabled ? budget.maxColliderJobsPerFrame : Number.POSITIVE_INFINITY;
    const frameOverBudget = () => budget.enabled && performance.now() - startedAt >= maxMs;
    let geometryJobs = 0;
    let colliderJobs = 0;
    let priorityColliderApplied = false;

    while (this.geometryJobs.length > 0 && geometryJobs < maxGeometryJobs) {
      if (geometryJobs > 0 && frameOverBudget()) break;
      const job = this.geometryJobs.shift();
      if (!job) break;
      try {
        const result = this.deps.applyGeometry(job.node);
        const applied = geometryApplied(result);
        this.statsRecorder.recordGeometry(
          result.geometryMs,
          result.triangles || triangleCount(job.node.mesh),
          result.reusedGeometry,
          applied,
        );
        this.statsRecorder.recordMaterial(result.materialMs);
        if (applied) this.deps.onGeometryApplied?.(job.node);
        if (job.node.level === 0) this.enqueueCollider(job.node, job.enqueuedFrame);
      } catch (error) {
        this.reportFailure("geometry", job.node, error);
      }
      geometryJobs++;
    }

    this.sortColliderJobs();
    while (this.colliderJobs.length > 0) {
      const nextJob = this.colliderJobs[0];
      const allowPriorityOverride = Boolean(nextJob?.priorityOverride && !priorityColliderApplied);
      if (colliderJobs >= maxColliderJobs && !allowPriorityOverride) break;
      if ((geometryJobs + colliderJobs) > 0 && frameOverBudget() && !allowPriorityOverride) break;
      const job = this.colliderJobs.shift();
      if (!job) break;
      try {
        const staleFrames = Math.max(0, this.deps.getFrameId() - job.enqueuedFrame);
        this.statsRecorder.recordColliderStaleFrames(staleFrames);
        if (job.priorityOverride) {
          priorityColliderApplied = true;
          this.statsRecorder.recordColliderPriorityOverride();
        }
        this.statsRecorder.recordCollider(this.deps.applyCollider(job.node));
      } catch (error) {
        this.reportFailure("collider", job.node, error);
      }
      colliderJobs++;
    }

    const totalMs = performance.now() - startedAt;
    if (budget.enabled && totalMs > maxMs && (geometryJobs + colliderJobs) > 0) {
      this.statsRecorder.recordBudgetExceeded();
    }
    if (budget.debugLogSpikes && totalMs >= budget.spikeLogThresholdMs) {
      console.debug(
        `[clod-apply] ${totalMs.toFixed(2)}ms geometry=${geometryJobs} collider=${colliderJobs}` +
          ` pending=${this.geometryJobs.length}/${this.colliderJobs.length}`,
      );
    }
    this.statsRecorder.finishFrame(totalMs);
    this.updateDepthStats();
    return this.statsRecorder.snapshot();
  }

  stats(): ClodApplyStatsSnapshot {
    this.updateDepthStats();
    return this.statsRecorder.snapshot();
  }

  private enqueueGeometry(node: ClodPageNode): void {
    removeNodeJob(this.geometryJobs, node.id);
    removeNodeJob(this.colliderJobs, node.id);
    this.geometryJobs.push({
      node,
      sequence: this.nextSequence++,
      enqueuedFrame: this.deps.getFrameId(),
    });
  }

  private enqueueCollider(node: ClodPageNode, enqueuedFrame: number): void {
    removeNodeJob(this.colliderJobs, node.id);
    const staleFrames = Math.max(0, this.deps.getFrameId() - enqueuedFrame);
    this.colliderJobs.push({
      node,
      enqueuedFrame,
      sequence: this.nextSequence++,
      priorityOverride: staleFrames >= this.deps.budget.colliderMaxDelayFrames,
    });
  }

  private sortGeometryJobs(): void {
    this.geometryJobs.sort((a, b) => this.priority(a) - this.priority(b));
  }

  private sortColliderJobs(): void {
    for (const job of this.colliderJobs) {
      const staleFrames = Math.max(0, this.deps.getFrameId() - job.enqueuedFrame);
      job.priorityOverride = job.priorityOverride || staleFrames >= this.deps.budget.colliderMaxDelayFrames;
    }
    this.colliderJobs.sort((a, b) => {
      if (a.priorityOverride !== b.priorityOverride) return a.priorityOverride ? -1 : 1;
      return this.priority(a) - this.priority(b);
    });
  }

  private priority(job: ClodApplyJob): number {
    const budget = this.deps.budget;
    let score = job.sequence;
    if (budget.prioritizeLod0) score += job.node.level * 1_000_000;
    if (this.deps.isNodeVisible(job.node.id)) score -= 100_000;
    if (budget.prioritizeNearCamera) {
      const camera = this.deps.getCameraPosition();
      const center = job.node.bounds.center;
      const dx = center[0] - camera.x;
      const dz = center[2] - camera.z;
      score += Math.min(999_999, dx * dx + dz * dz);
    }
    return score;
  }

  private updateDepthStats(): void {
    let staleVisibleNodes = 0;
    if (this.deps.budget.keepStaleVisible) {
      for (const job of this.geometryJobs) {
        if (this.deps.isNodeVisible(job.node.id)) staleVisibleNodes++;
      }
    }
    this.statsRecorder.setQueueDepths(this.geometryJobs.length, this.colliderJobs.length, staleVisibleNodes);
  }

  private reportFailure(kind: ClodApplyFailureKind, node: ClodPageNode, error: unknown): void {
    if (this.deps.onApplyFailed) {
      this.deps.onApplyFailed(kind, node, error);
      return;
    }
    console.error(`[clod-apply] ${kind} apply failed for ${node.id}:`, error);
  }
}
