import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { ClodWorkerClient } from "./clod_worker_client.js";

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).Worker = MockWorker as unknown as typeof Worker;
});

describe("ClodWorkerClient parent error lifecycle", () => {
  let client: ClodWorkerClient;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    onError = vi.fn();
    client = new ClodWorkerClient();
    client.onError = onError as (error: Error) => void;
  });

  it("starts healthy", () => {
    expect(client.isParentsHealthy()).toBe(true);
    expect(client.getLastParentError()).toBeNull();
  });

  it("sets unhealthy state when error arrives without matching pending request", () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    mockWorker.onmessage!({ data: { type: "error", requestId: 999, message: "parent drain failed" } } as MessageEvent);

    expect(client.isParentsHealthy()).toBe(false);
    expect(client.getLastParentError()?.message).toBe("parent drain failed");
    expect(onError).toHaveBeenCalled();
  });

  it("recovers healthy state on parentsComplete", () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    mockWorker.onmessage!({ data: { type: "error", requestId: 999, message: "parent drain failed" } } as MessageEvent);
    expect(client.isParentsHealthy()).toBe(false);

    mockWorker.onmessage!({ data: { type: "parentsComplete", requestId: 999, parentNodes: 5, parentMs: 10 } } as MessageEvent);
    expect(client.isParentsHealthy()).toBe(true);
    expect(client.getLastParentError()).toBeNull();
  });

  it("rejects pending requests as normal before triggering parent failure", async () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;

    // Start a dig
    const digPromise = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );

    // Find the dig requestId from the worker's postMessage mock
    const digCall = mockWorker.postMessage.mock.calls.find(
      ([msg]: unknown[]) => (msg as Record<string, unknown>).type === "dig",
    );
    expect(digCall).toBeDefined();
    const requestId = (digCall![0] as Record<string, unknown>).requestId as number;

    // Send an error for that requestId — should reject the pending request, not trigger parent failure
    mockWorker.onmessage!({ data: { type: "error", requestId, message: "dig failed" } } as MessageEvent);

    await expect(digPromise).rejects.toThrow("dig failed");
    expect(client.isParentsHealthy()).toBe(true);
  });

  it("dig queue continues after parent failure", async () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;

    // Trigger parent failure
    mockWorker.onmessage!({ data: { type: "error", requestId: 999, message: "parent drain failed" } } as MessageEvent);
    expect(client.isParentsHealthy()).toBe(false);

    // Now try a dig — it should still work
    const digPromise = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );

    const digCall = mockWorker.postMessage.mock.calls.find(
      ([msg]: unknown[]) => (msg as Record<string, unknown>).type === "dig",
    );
    expect(digCall).toBeDefined();

    const requestId = (digCall![0] as Record<string, unknown>).requestId as number;
    mockWorker.onmessage!({
      data: {
        type: "lod0Rebuilt",
        requestIds: [requestId],
        changed: [],
        dirtyCoords: [],
        lod0Pages: 0,
        lod0Ms: 0,
        serializeMs: 0,
        serializedBytes: 0,
        chunksRemeshed: 0,
        chunksTotal: 0,
        pendingParents: 0,
      },
    } as MessageEvent);

    await expect(digPromise).resolves.toBeDefined();
  });
});
