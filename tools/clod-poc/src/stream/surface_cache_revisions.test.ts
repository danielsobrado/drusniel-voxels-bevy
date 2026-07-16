import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectSurfaceCommitBridge,
  emitSurfaceCommit,
  resetSurfaceCacheRevisionsForTests,
  surfaceRevisionAt,
  subscribeSurfaceCommits,
} from "./surface_cache_revisions.js";

const bounds = (minX: number, minZ = 0) => ({ minX, minZ, maxX: minX + 10, maxZ: minZ + 10 });

beforeEach(resetSurfaceCacheRevisionsForTests);

describe("surface cache revisions", () => {
  it("uses one monotonic revision across independent tile sources", () => {
    const observed: number[] = [];
    subscribeSurfaceCommits((commit) => observed.push(commit.globalRevision));

    emitSurfaceCommit(bounds(0));
    emitSurfaceCommit(bounds(20));
    emitSurfaceCommit(bounds(0));

    expect(observed).toEqual([1, 2, 3]);
    expect(surfaceRevisionAt()).toBe(3);
  });

  it("replays missed commits and coalesces a burst into one bounds invalidation", async () => {
    emitSurfaceCommit(bounds(0));
    const markStale = vi.fn();
    const disconnect = connectSurfaceCommitBridge({ markStale }, { sinceRevision: 0 });
    emitSurfaceCommit(bounds(20, -5));
    emitSurfaceCommit(bounds(40, 5));

    await Promise.resolve();

    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalledWith({ minX: 0, minZ: -5, maxX: 50, maxZ: 15 });
    disconnect();
  });
});
