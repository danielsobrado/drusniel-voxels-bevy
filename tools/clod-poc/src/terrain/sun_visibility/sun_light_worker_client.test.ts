import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSunLightRemoteTileBuilder } from "./sun_light_worker_client.js";
import type { SunLightWorkerTileRequest } from "./sun_light_worker_protocol.js";

class FakeWorker {
  static latest: FakeWorker | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.latest = this;
  }
}

const tiles: SunLightWorkerTileRequest[] = [{
  key: "0|0,0|sun",
  tileX: 0,
  tileZ: 0,
  lod: 0,
  sunVec: [0, 1, 0],
  sunBin: { azimuthIndex: 0, elevationIndex: 0 },
  terrainRevision: 0,
  frameIndex: 1,
}];

function latestWorker(): FakeWorker {
  if (!FakeWorker.latest) throw new Error("fake sun-light worker was not created");
  return FakeWorker.latest;
}

function lastRequest(worker: FakeWorker): { requestId: number; configId: number } {
  const request = worker.postMessage.mock.calls.at(-1)?.[0] as {
    requestId?: number;
    configId?: number;
  } | undefined;
  if (!request || typeof request.requestId !== "number" || typeof request.configId !== "number") {
    throw new Error("sun-light build request was not posted");
  }
  return { requestId: request.requestId, configId: request.configId };
}

beforeEach(() => {
  FakeWorker.latest = null;
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sun-light worker lifecycle", () => {
  it("resolves a valid built response", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    const pending = client.build(tiles);
    const request = lastRequest(worker);

    worker.onmessage?.({
      data: {
        type: "built",
        requestId: request.requestId,
        configId: request.configId,
        tiles: [{ key: tiles[0]!.key, resolution: 2, values: new Uint8Array([1, 2, 3, 4]) }],
        buildMs: 0.5,
      },
    } as MessageEvent);

    await expect(pending).resolves.toEqual([
      { key: tiles[0]!.key, resolution: 2, values: new Uint8Array([1, 2, 3, 4]) },
    ]);
    expect(client.available()).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
    client.dispose();
  });

  it("preserves the empty stale-configuration requeue signal", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    client.configure({ summary: null } as never);
    const pending = client.build(tiles);
    const request = lastRequest(worker);
    client.configure({ summary: null } as never);

    worker.onmessage?.({
      data: {
        type: "built",
        requestId: request.requestId,
        configId: request.configId,
        tiles: [],
        buildMs: 0,
      },
    } as MessageEvent);

    await expect(pending).resolves.toEqual([]);
    expect(client.available()).toBe(true);
    client.dispose();
  });

  it("silently disables the optimization when configuration cannot be posted", () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException("could not clone", "DataCloneError");
    });

    expect(() => client.configure({ summary: null } as never)).not.toThrow();
    expect(client.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    client.configure({ summary: null } as never);
    expect(worker.postMessage).toHaveBeenCalledOnce();
  });

  it("rejects every pending batch after an unreadable response", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    const first = client.build(tiles);
    const second = client.build(tiles);

    worker.onmessageerror?.({ data: null } as MessageEvent);

    await expect(first).rejects.toThrow("could not be deserialized");
    await expect(second).rejects.toThrow("could not be deserialized");
    expect(client.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed on malformed tile payloads", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    const pending = client.build(tiles);
    const request = lastRequest(worker);

    worker.onmessage?.({
      data: {
        type: "built",
        requestId: request.requestId,
        configId: request.configId,
        tiles: [{ key: tiles[0]!.key, resolution: 2, values: new Uint8Array(3) }],
        buildMs: 0.5,
      },
    } as MessageEvent);

    await expect(pending).rejects.toThrow("invalid protocol message");
    expect(client.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails terminally when posting a build request throws", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("channel closed");
    });

    await expect(client.build(tiles)).rejects.toThrow("postMessage failed: channel closed");
    await expect(client.build(tiles)).rejects.toThrow("unavailable");
    expect(client.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects pending work and terminates once after a worker crash", async () => {
    const client = createSunLightRemoteTileBuilder()!;
    const worker = latestWorker();
    const pending = client.build(tiles);

    worker.onerror?.({ message: "boom" } as ErrorEvent);

    await expect(pending).rejects.toThrow("sun-light build worker crashed: boom");
    expect(client.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onerror?.({ message: "late" } as ErrorEvent);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
