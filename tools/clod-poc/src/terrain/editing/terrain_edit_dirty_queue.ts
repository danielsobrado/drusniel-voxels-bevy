export type TerrainEditDirtyReason = "dig" | "raise" | "build" | "paint";

export interface TerrainEditDirtyAabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainEditDirtyEvent {
  editRevision: number;
  worldAabb: TerrainEditDirtyAabb;
  reason: TerrainEditDirtyReason;
  affectsHeight: boolean;
  affectsCollision: boolean;
  affectsVegetation: boolean;
}

export interface TerrainEditDirtyQueueSnapshot {
  queued: number;
  latestRevision: number;
}

export class TerrainEditDirtyQueue {
  private readonly events: TerrainEditDirtyEvent[] = [];
  private latestRevisionValue = 0;

  enqueue(event: TerrainEditDirtyEvent): void {
    this.events.push(event);
    this.latestRevisionValue = Math.max(this.latestRevisionValue, event.editRevision);
  }

  drain(): TerrainEditDirtyEvent[] {
    return this.events.splice(0);
  }

  peek(): readonly TerrainEditDirtyEvent[] {
    return this.events;
  }

  snapshot(): TerrainEditDirtyQueueSnapshot {
    return {
      queued: this.events.length,
      latestRevision: this.latestRevisionValue,
    };
  }
}

export function dirtyAabbForBrush(x: number, y: number, z: number, radius: number, height: number, margin: number): TerrainEditDirtyAabb {
  return {
    minX: x - radius - margin,
    maxX: x + radius + margin,
    minY: y - height - margin,
    maxY: y + height + margin,
    minZ: z - radius - margin,
    maxZ: z + radius + margin,
  };
}
