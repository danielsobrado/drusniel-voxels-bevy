import type { StreamedRootRenderState } from "../../types.js";

export interface ActiveRootTransition {
  id: number;
  fromRootIds: Set<string>;
  toRootIds: Set<string>;
  startedFrame: number;
  durationFrames: number;
}

export interface RootTransitionSnapshot {
  activeGroups: number;
  activeRoots: number;
  fadeIn: number;
  fadeOut: number;
  drawOverhead: number;
  progressMin: number;
  progressMax: number;
}

export const TRANSITION_MS_SAMPLE_LIMIT = 128;

export function stableSetKey(ids: Iterable<string>): string {
  return [...ids].sort().join("|");
}

export function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function transitionProgress(transition: ActiveRootTransition, frame: number): number {
  return Math.max(0, Math.min(1, (frame - transition.startedFrame) / transition.durationFrames));
}

export function transitionRenderableRootIds(
  transition: ActiveRootTransition,
  isResident: (id: string) => boolean,
): Set<string> {
  return new Set([...transition.fromRootIds, ...transition.toRootIds].filter((id) => isResident(id)));
}

export function transitionExtraRoots(fromRootIds: ReadonlySet<string>, toRootIds: ReadonlySet<string>): number {
  return [...fromRootIds].filter((id) => !toRootIds.has(id)).length;
}

export function rootTransitionRenderMode(
  transition: ActiveRootTransition,
  id: string,
): StreamedRootRenderState["mode"] {
  if (transition.fromRootIds.has(id) && !transition.toRootIds.has(id)) return "fadeOut";
  if (transition.toRootIds.has(id) && !transition.fromRootIds.has(id)) return "fadeIn";
  return "stable";
}

export function rootTransitionStateForNode(
  transition: ActiveRootTransition,
  id: string,
  progress: number,
): StreamedRootRenderState {
  const mode = rootTransitionRenderMode(transition, id);
  return {
    mode,
    progress: mode === "stable" ? 1 : progress,
    groupId: transition.id,
    parentHeightMorphReady: false,
  };
}

export function emptyRootTransitionSnapshot(): RootTransitionSnapshot {
  return { activeGroups: 0, activeRoots: 0, fadeIn: 0, fadeOut: 0, drawOverhead: 0, progressMin: 0, progressMax: 0 };
}

export function snapshotRootTransition(
  transition: ActiveRootTransition | null,
  frame: number,
  isResident: (id: string) => boolean,
  getMode: (id: string) => StreamedRootRenderState["mode"] | undefined,
): RootTransitionSnapshot {
  if (!transition) return emptyRootTransitionSnapshot();
  const ids = transitionRenderableRootIds(transition, isResident);
  let fadeIn = 0;
  let fadeOut = 0;
  for (const id of ids) {
    const mode = getMode(id);
    if (mode === "fadeIn") fadeIn++;
    if (mode === "fadeOut") fadeOut++;
  }
  const progress = transitionProgress(transition, frame);
  return {
    activeGroups: 1,
    activeRoots: fadeIn + fadeOut,
    fadeIn,
    fadeOut,
    drawOverhead: fadeOut,
    progressMin: progress,
    progressMax: progress,
  };
}

export function createActiveRootTransition(
  fromRootIds: ReadonlySet<string>,
  toRootIds: ReadonlySet<string>,
  startedFrame: number,
  durationFrames: number,
  id: number,
): ActiveRootTransition {
  return {
    id,
    fromRootIds: new Set(fromRootIds),
    toRootIds: new Set(toRootIds),
    startedFrame,
    durationFrames,
  };
}
