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
  markStale(bounds: SurfaceBounds): void;
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

export function surfaceRevisionAt(): number {
  return globalRevision;
}

export function surfaceCommitsSince(revision: number): readonly SurfaceCommit[] {
  return history.filter((commit) => commit.globalRevision > revision);
}

export function emitSurfaceCommit(bounds: SurfaceBounds): SurfaceCommit {
  const commit: SurfaceCommit = {
    globalRevision: ++globalRevision,
    bounds: normalizedBounds(bounds),
  };
  history.push(commit);
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
  for (const listener of listeners) listener(commit);
  return commit;
}

export function subscribeSurfaceCommits(
  listener: (commit: SurfaceCommit) => void,
  options: { sinceRevision?: number } = {},
): () => void {
  const sinceRevision = Math.max(0, Math.floor(options.sinceRevision ?? globalRevision));
  for (const commit of surfaceCommitsSince(sinceRevision)) listener(commit);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function connectSurfaceCommitBridge(
  target: SurfaceCommitTarget,
  options: { sinceRevision?: number } = {},
): () => void {
  let active = true;
  let pendingBounds: SurfaceBounds | null = null;
  let flushScheduled = false;
  const schedule = (commit: SurfaceCommit) => {
    pendingBounds = unionBounds(pendingBounds, commit.bounds);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (!active || !pendingBounds) return;
      const bounds = pendingBounds;
      pendingBounds = null;
      target.markStale(bounds);
    });
  };
  const unsubscribe = subscribeSurfaceCommits(schedule, options);
  return () => {
    active = false;
    pendingBounds = null;
    unsubscribe();
  };
}

export function resetSurfaceCacheRevisionsForTests(): void {
  globalRevision = 0;
  history = [];
  listeners.clear();
}
