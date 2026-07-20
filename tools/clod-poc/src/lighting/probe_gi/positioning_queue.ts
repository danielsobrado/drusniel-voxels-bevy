import { probeGiColumnMatches } from "./cascade_layout.js";
import type { ProbeGiCascadeState } from "./types.js";

export interface ProbeGiPendingColumn {
  readonly cascade: ProbeGiCascadeState;
  readonly worldCellX: number;
  readonly worldCellZ: number;
  readonly readyFrame: number;
}

export function rebuildProbeGiPositioningQueue(
  cascade: ProbeGiCascadeState,
  readyFrame: number,
): ProbeGiPendingColumn[] {
  const [sizeX, , sizeZ] = cascade.config.dimensions;
  const queue: ProbeGiPendingColumn[] = [];
  for (let localZ = 0; localZ < sizeZ; localZ++) {
    const worldCellZ = cascade.origin.cellZ + localZ;
    for (let localX = 0; localX < sizeX; localX++) {
      const worldCellX = cascade.origin.cellX + localX;
      if (probeGiColumnMatches(cascade, worldCellX, worldCellZ)) continue;
      queue.push({ cascade, worldCellX, worldCellZ, readyFrame });
    }
  }
  return queue;
}

export function takeNextProbeGiPendingColumn(
  queues: readonly ProbeGiPendingColumn[][],
  frame: number,
): ProbeGiPendingColumn | null {
  for (const queue of queues) {
    const count = queue.length;
    for (let index = 0; index < count; index++) {
      const item = queue.shift();
      if (!item) break;
      if (item.readyFrame <= frame) return item;
      queue.push(item);
    }
  }
  return null;
}

export function probeGiPendingColumnCount(queues: readonly ProbeGiPendingColumn[][]): number {
  return queues.reduce((total, queue) => total + queue.length, 0);
}
