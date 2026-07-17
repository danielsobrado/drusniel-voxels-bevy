export interface SurfaceBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface SurfaceCommit {
  globalRevision: number;
  bounds: SurfaceBounds;
}

export interface SurfaceCommitTarget {
  markStale(bounds: SurfaceBounds | null): void;
}

const HISTORY_LIMIT = 4096;
let globalRevision = 0;
let history: SurfaceCommit[] = [];
const listeners = new Set<(commit: SurfaceCommit) => void>();

function normalizedBounds(bounds: SurfaceBounds): SurfaceBounds {
  if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite)) {
    throw new Error("surface commit bounds must be finite");
  }
  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };
}

function unionBounds(a: SurfaceBounds | null, b: SurfaceBounds): SurfaceBounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function boundsIntersect(a: SurfaceBounds, b: SurfaceBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX
    && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function surfaceRevisionAt(): number {
  return globalRevision;
}

export function surfaceCommitsSince(revision: number): readonly SurfaceCommit[] {
  return history.filter((commit) => commit.globalRevision > revision);
}

export function surfaceBoundsChangedSince(bounds: SurfaceBounds, revision: number): boolean {
  const normalizedRevision = Math.max(0, Math.floor(Number.isFinite(revision) ? revision : 0));
  if (normalizedRevision >= globalRevision) return false;
  const oldestRetainedRevision = history[0]?.globalRevision ?? globalRevision + 1;
  if (normalizedRevision < oldestRetainedRevision - 1) return true;
  const target = normalizedBounds(bounds);
  return history.some((commit) => commit.globalRevision > normalizedRevision && boundsIntersect(target, commit.bounds));
}

export function emitSurfaceCommit(bounds: SurfaceBounds): SurfaceCommit {
  const commit: SurfaceCommit = {
    globalRevision: ++globalRevision,
    bounds: normalizedBounds(bounds),
  };
  history.push(commit);
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
  for (const listener of listeners) notifyListener(listener, commit);
  return commit;
}

export function subscribeSurfaceCommits(
  listener: (commit: SurfaceCommit) => void,
  options: { sinceRevision?: number } = {},
): () => void {
  const sinceRevision = Math.max(0, Math.floor(options.sinceRevision ?? globalRevision));
  for (const commit of surfaceCommitsSince(sinceRevision)) notifyListener(listener, commit);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function connectSurfaceCommitBridge(
  target: SurfaceCommitTarget,
  options: { sinceRevision?: number } = {},
): () => void {
  let active = true;
  let pendingBounds: SurfaceBounds | null = null;
  let markAllStale = false;
  let flushScheduled = false;
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (!active || (!markAllStale && !pendingBounds)) return;
      const bounds = pendingBounds;
      pendingBounds = null;
      const invalidateAll = markAllStale;
      markAllStale = false;
      target.markStale(invalidateAll ? null : bounds);
    });
  };
  const schedule = (commit: SurfaceCommit) => {
    if (!markAllStale) pendingBounds = unionBounds(pendingBounds, commit.bounds);
    scheduleFlush();
  };
  const sinceRevision = Math.max(0, Math.floor(options.sinceRevision ?? globalRevision));
  const oldestRetainedRevision = history[0]?.globalRevision ?? globalRevision + 1;
  const historyGap = sinceRevision < globalRevision && sinceRevision < oldestRetainedRevision - 1;
  if (historyGap) {
    markAllStale = true;
    scheduleFlush();
  }
  const unsubscribe = subscribeSurfaceCommits(schedule, {
    sinceRevision: historyGap ? globalRevision : sinceRevision,
  });
  return () => {
    active = false;
    pendingBounds = null;
    unsubscribe();
  };
}

function notifyListener(listener: (commit: SurfaceCommit) => void, commit: SurfaceCommit): void {
  try {
    listener(commit);
  } catch (error) {
    console.error("[surface-cache] surface commit listener failed", error);
  }
}

export function resetSurfaceCacheRevisionsForTests(): void {
  globalRevision = 0;
  history = [];
  listeners.clear();
}
