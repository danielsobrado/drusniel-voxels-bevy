import { describe, expect, it } from "vitest";
import { TerrainEditDirtyQueue, dirtyAabbForBrush } from "./terrain_edit_dirty_queue.js";

describe("TerrainEditDirtyQueue", () => {
  it("queues and drains edit dirty events", () => {
    const queue = new TerrainEditDirtyQueue();
    queue.enqueue({
      editRevision: 7,
      worldAabb: dirtyAabbForBrush(10, 20, 30, 4, 6, 2),
      reason: "dig",
      affectsHeight: true,
      affectsCollision: true,
      affectsVegetation: true,
    });

    expect(queue.snapshot()).toEqual({ queued: 1, latestRevision: 7, dropped: 0 });
    expect(queue.peek()).toHaveLength(1);
    expect(queue.drain()).toHaveLength(1);
    expect(queue.snapshot()).toEqual({ queued: 0, latestRevision: 7, dropped: 0 });
  });

  it("drops oldest events after the configured bound", () => {
    const queue = new TerrainEditDirtyQueue(1);
    queue.enqueue({
      editRevision: 1,
      worldAabb: dirtyAabbForBrush(0, 0, 0, 1, 1, 0),
      reason: "dig",
      affectsHeight: true,
      affectsCollision: true,
      affectsVegetation: true,
    });
    queue.enqueue({
      editRevision: 2,
      worldAabb: dirtyAabbForBrush(2, 0, 0, 1, 1, 0),
      reason: "raise",
      affectsHeight: true,
      affectsCollision: true,
      affectsVegetation: true,
    });

    expect(queue.snapshot()).toEqual({ queued: 1, latestRevision: 2, dropped: 1 });
    expect(queue.peek()[0]?.editRevision).toBe(2);
  });

  it("computes conservative brush bounds", () => {
    expect(dirtyAabbForBrush(10, 20, 30, 4, 6, 2)).toEqual({
      minX: 4,
      maxX: 16,
      minY: 12,
      maxY: 28,
      minZ: 24,
      maxZ: 36,
    });
  });
});
