export type TerrainEditDirtyReason = "dig" | "raise" | "build" | "paint" | "spell";

const DEFAULT_MAX_DIRTY_EVENTS = 4096;

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
  dropped: number;
}

function resolveMaxEvents(maxEvents: number): number {
  return Number.isFinite(maxEvents) && maxEvents > 0 ? Math.floor(maxEvents) : DEFAULT_MAX_DIRTY_EVENTS;
}

export class TerrainEditDirtyQueue {
  private readonly events = new Map<string, TerrainEditDirtyEvent>();
  private readonly maxEvents: number;
  private latestRevisionValue = 0;
  private droppedValue = 0;

  constructor(maxEvents = DEFAULT_MAX_DIRTY_EVENTS) {
    this.maxEvents = resolveMaxEvents(maxEvents);
  }

  enqueue(event: TerrainEditDirtyEvent): void {
    const centerX = (event.worldAabb.minX + event.worldAabb.maxX) * 0.5;
    const centerZ = (event.worldAabb.minZ + event.worldAabb.maxZ) * 0.5;
    const key = `${event.reason}:${Math.floor(centerX / 16)},${Math.floor(centerZ / 16)}`;
    const previous = this.events.get(key);
    this.events.set(key, previous ? {
      ...event,
      editRevision: Math.max(previous.editRevision, event.editRevision),
      worldAabb: {
        minX: Math.min(previous.worldAabb.minX, event.worldAabb.minX),
        maxX: Math.max(previous.worldAabb.maxX, event.worldAabb.maxX),
        minY: Math.min(previous.worldAabb.minY, event.worldAabb.minY),
        maxY: Math.max(previous.worldAabb.maxY, event.worldAabb.maxY),
        minZ: Math.min(previous.worldAabb.minZ, event.worldAabb.minZ),
        maxZ: Math.max(previous.worldAabb.maxZ, event.worldAabb.maxZ),
      },
      affectsHeight: previous.affectsHeight || event.affectsHeight,
      affectsCollision: previous.affectsCollision || event.affectsCollision,
      affectsVegetation: previous.affectsVegetation || event.affectsVegetation,
    } : event);
    this.latestRevisionValue = Math.max(this.latestRevisionValue, event.editRevision);
    while (this.events.size > this.maxEvents) {
      this.events.delete(this.events.keys().next().value!);
      this.droppedValue++;
    }
  }

  drain(): TerrainEditDirtyEvent[] {
    const drained = [...this.events.values()];
    this.events.clear();
    return drained;
  }

  peek(): readonly TerrainEditDirtyEvent[] {
    return [...this.events.values()];
  }

  snapshot(): TerrainEditDirtyQueueSnapshot {
    return {
      queued: this.events.size,
      latestRevision: this.latestRevisionValue,
      dropped: this.droppedValue,
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
