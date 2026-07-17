import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectSurfaceCommitBridge,
  emitSurfaceCommit,
  resetSurfaceCacheRevisionsForTests,
  surfaceBoundsChangedSince,
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

  it("detects only intersecting commits newer than the build revision", () => {
    emitSurfaceCommit(bounds(0));
    const buildRevision = surfaceRevisionAt();
    emitSurfaceCommit(bounds(20));

    expect(surfaceBoundsChangedSince(bounds(0), buildRevision)).toBe(false);
    expect(surfaceBoundsChangedSince(bounds(20), buildRevision)).toBe(true);
  });

  it("uses half-open bounds so touching tile edges do not invalidate each other", () => {
    const buildRevision = surfaceRevisionAt();
    emitSurfaceCommit(bounds(10));

    expect(surfaceBoundsChangedSince(bounds(0), buildRevision)).toBe(false);
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

  it("marks everything stale when a subscriber is older than retained history", async () => {
    for (let index = 0; index < 4_097; index++) emitSurfaceCommit(bounds(index * 20));
    const markStale = vi.fn();

    const disconnect = connectSurfaceCommitBridge({ markStale }, { sinceRevision: 0 });
    await Promise.resolve();

    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalledWith(null);
    disconnect();
  });

  it("isolates throwing listeners from the commit path and remaining listeners", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const observed: number[] = [];
    subscribeSurfaceCommits(() => { throw new Error("listener failed"); });
    subscribeSurfaceCommits((commit) => observed.push(commit.globalRevision));

    expect(() => emitSurfaceCommit(bounds(0))).not.toThrow();
    expect(observed).toEqual([1]);
    expect(error).toHaveBeenCalledOnce();
  });
});
