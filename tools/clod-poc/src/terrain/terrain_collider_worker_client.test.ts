import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerrainColliderRemoteBuilder } from "./terrain_collider_worker_client.js";

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

function input() {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

function currentWorker(): MockWorker {
  const worker = MockWorker.instances.at(-1);
  if (!worker) throw new Error("mock terrain collider worker was not created");
  return worker;
}

function currentRequest(worker: MockWorker): { requestId: number } {
  const request = worker.postMessage.mock.calls.at(-1)?.[0] as { requestId?: number } | undefined;
  if (!request || typeof request.requestId !== "number") throw new Error("collider worker request was not posted");
  return { requestId: request.requestId };
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

describe("terrain collider worker client failover", () => {
  it("resolves a valid BVH response without disabling the worker", async () => {
    const builder = createTerrainColliderRemoteBuilder();
    expect(builder).not.toBeNull();
    const worker = currentWorker();
    const pending = builder!.build(input());
    const request = currentRequest(worker);
    const indexBuffer = new Uint16Array([0, 1, 2]).buffer;

    worker.onmessage!({
      data: {
        type: "built",
        requestId: request.requestId,
        roots: [new ArrayBuffer(4)],
        indexBuffer,
        indexKind: "uint16",
        buildMs: 0.5,
      },
    } as MessageEvent);

    const result = await pending;
    expect(result.buildMs).toBe(0.5);
    expect(result.serialized.version).toBe(1);
    expect(result.serialized.index).toBeInstanceOf(Uint16Array);
    expect(Array.from(result.serialized.index as Uint16Array)).toEqual([0, 1, 2]);
    expect(builder!.available()).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
    builder!.dispose();
  });

  it("keeps a normal build error request-scoped", async () => {
    const builder = createTerrainColliderRemoteBuilder()!;
    const worker = currentWorker();
    const pending = builder.build(input());
    const request = currentRequest(worker);

    worker.onmessage!({
      data: { type: "error", requestId: request.requestId, message: "invalid geometry" },
    } as MessageEvent);

    await expect(pending).rejects.toThrow("invalid geometry");
    expect(builder.available()).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
    builder.dispose();
  });

  it("rejects every pending build on response deserialization failure", async () => {
    const builder = createTerrainColliderRemoteBuilder()!;
    const worker = currentWorker();
    const first = builder.build(input());
    const second = builder.build(input());

    worker.onmessageerror!({ data: null } as MessageEvent);

    await expect(first).rejects.toThrow("could not be deserialized");
    await expect(second).rejects.toThrow("could not be deserialized");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    builder.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a response contains malformed BVH buffers", async () => {
    const builder = createTerrainColliderRemoteBuilder()!;
    const worker = currentWorker();
    const pending = builder.build(input());
    const request = currentRequest(worker);

    worker.onmessage!({
      data: {
        type: "built",
        requestId: request.requestId,
        roots: [],
        indexBuffer: new ArrayBuffer(3),
        indexKind: "uint16",
        buildMs: 0.5,
      },
    } as MessageEvent);

    await expect(pending).rejects.toThrow("invalid protocol message");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when postMessage throws synchronously", async () => {
    const builder = createTerrainColliderRemoteBuilder()!;
    const worker = currentWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("structured clone failed");
    });

    await expect(builder.build(input())).rejects.toThrow("postMessage failed");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(builder.build(input())).rejects.toThrow("unavailable");
  });

  it("rejects pending work and terminates once after a worker crash", async () => {
    const builder = createTerrainColliderRemoteBuilder()!;
    const worker = currentWorker();
    const pending = builder.build(input());

    worker.onerror!({ message: "worker exploded" } as ErrorEvent);

    await expect(pending).rejects.toThrow("worker exploded");
    expect(builder.available()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.onerror!({ message: "late error" } as ErrorEvent);
    builder.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
