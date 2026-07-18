import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHydrologyGraphWorkerClient } from "./hydrology_graph_worker_client.js";

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

const buildInput = {
  worldId: "worker-lifecycle-test",
  seed: 1,
  sizeM: { x: 64, z: 64 },
  terrainFieldConfig: null,
};

beforeEach(() => {
  FakeWorker.latest = null;
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hydrology graph worker lifecycle", () => {
  it("rejects pending and future builds after a worker crash", async () => {
    const client = createHydrologyGraphWorkerClient();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();

    const pending = client!.build(buildInput);
    worker!.onerror?.({ message: "boom" } as ErrorEvent);

    await expect(pending).rejects.toThrow("hydrology graph worker crashed: boom");
    await expect(client!.build(buildInput)).rejects.toThrow("hydrology graph worker crashed: boom");
    expect(client!.available()).toBe(false);
    expect(worker!.postMessage).not.toHaveBeenCalled();
    expect(worker!.terminate).toHaveBeenCalledOnce();

    client!.dispose();
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed when the worker produces an unreadable message", async () => {
    const client = createHydrologyGraphWorkerClient();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();

    worker!.onmessageerror?.({} as MessageEvent);

    expect(client!.available()).toBe(false);
    await expect(client!.build(buildInput)).rejects.toThrow("hydrology graph worker produced an unreadable message");
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });
});
