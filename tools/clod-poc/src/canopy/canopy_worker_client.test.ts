import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanopyRemoteTileBuilder } from "./canopy_worker_client.js";
import type { CanopyWorkerTileCoord } from "./canopy_worker_protocol.js";

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }
}

const workerGlobal = globalThis as unknown as Record<string, unknown>;
const hadOriginalWorker = "Worker" in workerGlobal;
const originalWorker = workerGlobal.Worker;

function tile(): CanopyWorkerTileCoord {
  return {
    key: { tileX: 0, tileZ: 0, ring: 0 },
    originX: 0,
    originZ: 0,
    cellSizeM: 8,
    resolution: 2,
    revision: 1,
  };
}

function currentWorker(): MockWorker {
  const worker = MockWorker.instances.at(-1);
  if (!worker) throw new Error("mock canopy worker was not created");
  return worker;
}

beforeAll(() => {
  workerGlobal.Worker = MockWorker as unknown as typeof Worker;
});

afterAll(() => {
  if (hadOriginalWorker) workerGlobal.Worker = originalWorker;
  else delete workerGlobal.Worker;
});

beforeEach(() => {
  vi.clearAllMocks();
  MockWorker.instances.length = 0;
});

describe("canopy worker client terminal fallback", () => {
  it("resolves a valid built response without disabling the worker", async () => {
    const builder = createCanopyRemoteTileBuilder();
    expect(builder).not.toBeNull();
    const worker = currentWorker();
    const pending = builder!.build([tile()]);
    const request = worker.postMessage.mock.calls[0]![0] as { requestId: number; configId: number };

    worker.onmessage!({
      data: {
        type: "built",
        requestId: request.requestId,
        configId: request.configId,
        tiles: [],
        buildMs: 0,
      },
    } as MessageEvent);

    await expect(pending).resolves.toEqual([]);
    expect(builder!.available()).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
    builder!.dispose();
  });

  it("rejects pending work and terminates on message deserialization failure", async () => {
    const builder = createCanopyRemoteTileBuilder()!;
    const worker = currentWorker();
    const pending = builder.build([tile()]);

    worker.onmessageerror!({ data: null } as MessageEvent);

    await expect(pending).rejects.toThrow("could not be deserialized");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    builder.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed worker responses", async () => {
    const builder = createCanopyRemoteTileBuilder()!;
    const worker = currentWorker();
    const pending = builder.build([tile()]);

    worker.onmessage!({ data: { type: "built", requestId: 1 } } as MessageEvent);

    await expect(pending).rejects.toThrow("invalid protocol message");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects pending work when postMessage throws synchronously", async () => {
    const builder = createCanopyRemoteTileBuilder()!;
    const worker = currentWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("structured clone failed");
    });

    await expect(builder.build([tile()])).rejects.toThrow("postMessage failed");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects every pending batch after a worker crash", async () => {
    const builder = createCanopyRemoteTileBuilder()!;
    const worker = currentWorker();
    const first = builder.build([tile()]);
    const second = builder.build([{ ...tile(), key: { tileX: 1, tileZ: 0, ring: 0 } }]);

    worker.onerror!({ message: "worker exploded" } as ErrorEvent);

    await expect(first).rejects.toThrow("worker exploded");
    await expect(second).rejects.toThrow("worker exploded");
    await expect(builder.build([tile()])).rejects.toThrow("unavailable");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
