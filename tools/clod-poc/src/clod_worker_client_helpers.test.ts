import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClodWorkerRequest } from "./clod_worker_protocol.js";
import { postTrackedRequest } from "./clod_worker_client_helpers.js";
import { buildStartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import type { PendingRequest } from "./clod_worker_client_types.js";

function buildRequest(): Extract<ClodWorkerRequest, { type: "build" }> {
  const raster = buildStartupHeightfieldRaster(16);
  expect(raster).not.toBeNull();
  return {
    type: "build",
    requestId: 1,
    worldPagesX: 1,
    worldPagesZ: 1,
    cfg: {} as Extract<ClodWorkerRequest, { type: "build" }>["cfg"],
    voxelEdits: { revision: 0, deltas: [] },
    startupHeightfield: raster,
    terrainSource: {} as Extract<ClodWorkerRequest, { type: "build" }>["terrainSource"],
  };
}

describe("CLOD worker startup heightfield handoff", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __drusnielStartupTimings?: Record<string, number> }).__drusnielStartupTimings;
  });

  it("copies once, transfers the worker copy, and preserves the main-thread raster", async () => {
    const timings: Record<string, number> = {};
    (globalThis as typeof globalThis & { __drusnielStartupTimings?: Record<string, number> }).__drusnielStartupTimings = timings;
    const postMessage = vi.fn();
    const worker = { postMessage } as unknown as Worker;
    const requests = new Map<number, PendingRequest<unknown>>();
    const request = buildRequest();
    const originalRaster = request.startupHeightfield!;
    const originalBuffer = originalRaster.heights.buffer;

    const promise = postTrackedRequest(requests, worker, request);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [outbound, transfer] = postMessage.mock.calls[0] as [typeof request, Transferable[]];
    const workerRaster = outbound.startupHeightfield!;

    expect(workerRaster).not.toBe(originalRaster);
    expect(workerRaster.heights).not.toBe(originalRaster.heights);
    expect(workerRaster.heights).toEqual(originalRaster.heights);
    expect(transfer).toEqual([workerRaster.heights.buffer]);
    expect(originalRaster.heights.buffer).toBe(originalBuffer);
    expect(originalRaster.heights.byteLength).toBe(originalRaster.byteLength);
    expect(timings["startup.heightfield_raster_samples"]).toBe(originalRaster.sampleCount);
    expect(timings["startup.heightfield_raster_bytes"]).toBe(originalRaster.byteLength);
    expect(timings["startup.heightfield_raster_worker_clone_ms"]).toBeGreaterThanOrEqual(0);
    expect(timings["startup.heightfield_raster_worker_transfer_ms"]).toBeGreaterThanOrEqual(0);

    requests.get(request.requestId)!.resolve({});
    await promise;
  });
});
