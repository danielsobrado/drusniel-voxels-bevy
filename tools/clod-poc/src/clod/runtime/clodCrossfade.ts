import type { ClodNodeId, ClodCut } from "./clodRuntimeTypes.js";
export type { ClodNodeId } from "./clodRuntimeTypes.js";
import { logger } from "./clodLogger.js";

export interface ClodTransition {
  id: string;
  fromNodeIds: ClodNodeId[];
  toNodeIds: ClodNodeId[];
  startFrame: number;
  durationFrames: number;
}

export interface ClodFadeState {
  nodeId: ClodNodeId;
  visible: boolean;
  fadeAlpha: number;
  ditherRole: "stable" | "fade-in" | "fade-out";
}

let nextTransitionId = 0;

export function createTransition(params: {
  previousCut: ClodCut | null;
  nextCut: ClodCut;
  frame: number;
  durationFrames: number;
}): ClodTransition | null {
  const { previousCut, nextCut, frame, durationFrames } = params;

  if (!previousCut || durationFrames <= 0) return null;

  const prevIds = new Set(previousCut.nodes.keys());
  const nextIds = new Set(nextCut.nodes.keys());

  const removed = [...prevIds].filter((id) => !nextIds.has(id));
  const added = [...nextIds].filter((id) => !prevIds.has(id));

  if (removed.length === 0 && added.length === 0) return null;

  const transition: ClodTransition = {
    id: `xfade-${nextTransitionId++}`,
    fromNodeIds: removed,
    toNodeIds: added,
    startFrame: frame,
    durationFrames,
  };

  logger.info(
    `transition started: ${transition.id} (${removed.length} fade-out, ${added.length} fade-in, ${durationFrames} frames)`,
  );

  return transition;
}

export function computeFadeStates(params: {
  activeTransition: ClodTransition | null;
  stableCut: ClodCut;
  frame: number;
}): Map<ClodNodeId, ClodFadeState> {
  const { activeTransition, stableCut, frame } = params;
  const fadeStates = new Map<ClodNodeId, ClodFadeState>();

  for (const [nodeId] of stableCut.nodes) {
    if (activeTransition && frame >= activeTransition.startFrame && frame < activeTransition.startFrame + activeTransition.durationFrames) {
      const elapsed = frame - activeTransition.startFrame;
      const progress = Math.min(1, elapsed / activeTransition.durationFrames);

      if (activeTransition.toNodeIds.includes(nodeId)) {
        fadeStates.set(nodeId, {
          nodeId,
          visible: true,
          fadeAlpha: progress,
          ditherRole: "fade-in",
        });
      } else {
        fadeStates.set(nodeId, {
          nodeId,
          visible: true,
          fadeAlpha: 1,
          ditherRole: "stable",
        });
      }
    } else {
      fadeStates.set(nodeId, {
        nodeId,
        visible: true,
        fadeAlpha: 1,
        ditherRole: "stable",
      });
    }
  }

  if (activeTransition) {
    const elapsed = frame - activeTransition.startFrame;
    const inProgress = elapsed >= 0 && elapsed < activeTransition.durationFrames;

    if (inProgress) {
      const progress = Math.min(1, elapsed / activeTransition.durationFrames);
      for (const nodeId of activeTransition.fromNodeIds) {
        if (!fadeStates.has(nodeId)) {
          fadeStates.set(nodeId, {
            nodeId,
            visible: true,
            fadeAlpha: 1 - progress,
            ditherRole: "fade-out",
          });
        }
      }
    }
  }

  return fadeStates;
}

export function isTransitionComplete(transition: ClodTransition, frame: number): boolean {
  return frame >= transition.startFrame + transition.durationFrames;
}

export function generateDitherPattern(size: number): Uint8Array {
  const pattern = new Uint8Array(size * size);
  const bayerMatrix = generateBayerMatrix(4);
  const bayerSize = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pattern[y * size + x] = bayerMatrix[y % bayerSize][x % bayerSize];
    }
  }
  return pattern;
}

function generateBayerMatrix(n: number): number[][] {
  if (n === 1) return [[0]];
  const smaller = generateBayerMatrix(n / 2);
  const half = n / 2;
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const v = smaller[y][x] * 4;
      result[y][x] = v;
      result[y][x + half] = v + 2;
      result[y + half][x] = v + 3;
      result[y + half][x + half] = v + 1;
    }
  }
  return result;
}
