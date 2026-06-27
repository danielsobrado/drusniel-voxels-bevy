import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { ClodWorkerClient } from "./clod_worker_client.js";
import type { ClodPageNode, PageMesh } from "./types.js";

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
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

describe("ClodWorkerClient parent error lifecycle", () => {
  let client: ClodWorkerClient;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    onError = vi.fn();
    client = new ClodWorkerClient();
    client.onError = onError as (error: Error) => void;
  });

  afterEach(() => {
    client.dispose();
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

    const digPromise = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );

    const digCall = mockWorker.postMessage.mock.calls.find(
      ([msg]: unknown[]) => (msg as Record<string, unknown>).type === "dig",
    );
    expect(digCall).toBeDefined();
    expect((digCall![0] as { dirtyRegions?: unknown[] }).dirtyRegions).toEqual([{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }]);
    const requestId = (digCall![0] as Record<string, unknown>).requestId as number;

    mockWorker.onmessage!({ data: { type: "error", requestId, message: "dig failed" } } as MessageEvent);

    await expect(digPromise).rejects.toThrow("dig failed");
    expect(client.isParentsHealthy()).toBe(true);
  });

  it("dig queue continues after parent failure", async () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;

    mockWorker.onmessage!({ data: { type: "error", requestId: 999, message: "parent drain failed" } } as MessageEvent);
    expect(client.isParentsHealthy()).toBe(false);

    const digPromise = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );

    const digCall = mockWorker.postMessage.mock.calls.find(
      ([msg]: unknown[]) => (msg as Record<string, unknown>).type === "dig",
    );
    expect(digCall).toBeDefined();

    const requestId = (digCall![0] as Record<string, unknown>).requestId as number;
    resolveDig(mockWorker, requestId, 1);

    await expect(digPromise).resolves.toMatchObject({ requestCount: 1 });
  });

  it("splits queued dig bursts into capped worker batches", async () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    const first = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );
    const firstCall = digCalls(mockWorker)[0];
    expect(firstCall).toBeDefined();

    const queued = Array.from({ length: 9 }, (_, i) => client.rebuildAfterDig(
      { x: i + 1, y: 0, z: 0, r: 1 },
      { minX: i + 1, maxX: i + 2, minZ: 0, maxZ: 1 },
    ));

    resolveDig(mockWorker, requestId(firstCall), 1);
    await first;
    await Promise.resolve();

    const secondCall = digCalls(mockWorker)[1];
    expect(secondCall).toBeDefined();
    expect((secondCall as { edits: unknown[] }).edits).toHaveLength(8);
    expect((secondCall as { dirtyRegions: unknown[] }).dirtyRegions).toHaveLength(8);

    resolveDig(mockWorker, requestId(secondCall), 8);
    await Promise.all(queued.slice(0, 8));
    await Promise.resolve();

    const thirdCall = digCalls(mockWorker)[2];
    expect(thirdCall).toBeDefined();
    expect((thirdCall as { edits: unknown[] }).edits).toHaveLength(1);
    expect((thirdCall as { dirtyRegions: unknown[] }).dirtyRegions).toHaveLength(1);

    resolveDig(mockWorker, requestId(thirdCall), 1);
    await expect(queued[8]).resolves.toMatchObject({ requestCount: 1 });
  });

  it("rejects sent and unsent dig work when disposed", async () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    const first = client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    );
    expect(digCalls(mockWorker)).toHaveLength(1);

    const queued = client.rebuildAfterDig(
      { x: 2, y: 0, z: 0, r: 1 },
      { minX: 2, maxX: 3, minZ: 0, maxZ: 1 },
    );

    client.dispose();

    await expect(first).rejects.toThrow("disposed");
    await expect(queued).rejects.toThrow("disposed");
    expect(mockWorker.terminate).toHaveBeenCalled();
  });

  it("rejects new dig work after disposal", async () => {
    client.dispose();
    await expect(client.rebuildAfterDig(
      { x: 0, y: 0, z: 0, r: 1 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    )).rejects.toThrow("stopped");
  });

  it("ignores queued worker failures after disposal", () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    client.dispose();

    mockWorker.onerror!({ message: "late worker failure" } as ErrorEvent);
    mockWorker.onmessage!({ data: { type: "error", requestId: null, message: "late parent failure" } } as MessageEvent);

    expect(onError).not.toHaveBeenCalled();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed without mutating a parent when a parent batch has an unknown child", () => {
    const mockWorker = (client as unknown as { worker: MockWorker }).worker;
    const child = node("L0:0,0", 0);
    const parent = node("L1:0,0", 1, [child]);
    const previousChildren = parent.children;
    const previousMesh = parent.mesh;
    (client as unknown as { nodesById: Map<string, ClodPageNode> }).nodesById = new Map([
      [child.id, child],
      [parent.id, parent],
    ]);

    mockWorker.onmessage!({
      data: {
        type: "parentRebuilt",
        requestId: 7,
        changed: [serializedNode("L1:0,0", 1, ["L0:missing"])],
        parentNodes: 1,
        parentMs: 0,
        pendingParents: 0,
      },
    } as MessageEvent);

    expect(mockWorker.terminate).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(client.isParentsHealthy()).toBe(false);
    expect(parent.children).toBe(previousChildren);
    expect(parent.mesh).toBe(previousMesh);
  });
});

function mesh(): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function node(id: string, level: number, children: ClodPageNode[] = []): ClodPageNode {
  return {
    id,
    level,
    children,
    mesh: mesh(),
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0.5, 0, 0.5], radius: 1, minY: 0, maxY: 0 },
    errorWorld: level,
    lowBenefit: false,
  };
}

function serializedNode(id: string, level: number, childIds: (string | null)[] = []) {
  return {
    id,
    level,
    childIds,
    mesh: mesh(),
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0.5, 0, 0.5], radius: 1, minY: 0, maxY: 0 },
    errorWorld: level,
    lowBenefit: false,
  };
}

function digCalls(worker: MockWorker): Array<Record<string, unknown>> {
  return worker.postMessage.mock.calls
    .map(([msg]: unknown[]) => msg as Record<string, unknown>)
    .filter((msg) => msg.type === "dig");
}

function requestId(message: Record<string, unknown>): number {
  return message.requestId as number;
}

function resolveDig(worker: MockWorker, requestId: number, editCount: number): void {
  worker.onmessage!({
    data: {
      type: "lod0Rebuilt",
      requestIds: [requestId],
      editCount,
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
}
