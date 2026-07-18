import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClodWorkerClient } from "./clod_worker_client.js";

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(): void {}

  emitMessage(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) listener(event);
    this.onmessage?.(event);
  }

  emitMessageError(): void {
    const event = {} as MessageEvent;
    for (const listener of this.listeners.get("messageerror") ?? []) listener(event);
  }
}

const workerGlobal = globalThis as unknown as Record<string, unknown>;
const hadOriginalWorker = "Worker" in workerGlobal;
const originalWorker = workerGlobal.Worker;

beforeAll(() => {
  workerGlobal.Worker = MockWorker as unknown as typeof Worker;
});

afterAll(() => {
  if (hadOriginalWorker) workerGlobal.Worker = originalWorker;
  else delete workerGlobal.Worker;
});

beforeEach(() => {
  vi.resetAllMocks();
  MockWorker.instances.length = 0;
});

describe("ClodWorkerClient protocol guard integration", () => {
  it("fails closed and rejects pending work on an unknown response type", async () => {
    const client = new ClodWorkerClient();
    const worker = MockWorker.instances[0]!;
    const onError = vi.fn();
    client.onError = onError;

    const pending = client.flushParents();
    worker.emitMessage({ type: "futureResponse", requestId: 1 });

    await expect(pending).rejects.toThrow("invalid protocol message");
    await expect(client.flushParents()).rejects.toThrow("stopped");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a known response is missing its request identity", async () => {
    const client = new ClodWorkerClient();
    const worker = MockWorker.instances[0]!;

    const pending = client.flushParents();
    worker.emitMessage({ type: "flushed" });

    await expect(pending).rejects.toThrow("invalid protocol message");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a worker message cannot be deserialized", async () => {
    const client = new ClodWorkerClient();
    const worker = MockWorker.instances[0]!;

    const pending = client.buildHeightfieldTiles([{ x: 0, z: 0 }]);
    worker.emitMessageError();

    await expect(pending).rejects.toThrow("could not be deserialized");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
