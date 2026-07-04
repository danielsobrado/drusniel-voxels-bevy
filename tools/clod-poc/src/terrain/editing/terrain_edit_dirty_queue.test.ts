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

    expect(queue.snapshot()).toEqual({ queued: 1, latestRevision: 7 });
    expect(queue.peek()).toHaveLength(1);
    expect(queue.drain()).toHaveLength(1);
    expect(queue.snapshot()).toEqual({ queued: 0, latestRevision: 7 });
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
