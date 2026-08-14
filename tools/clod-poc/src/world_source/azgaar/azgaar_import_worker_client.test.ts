import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { importAzgaarFullJson, type AzgaarFullJsonDocument } from "./azgaar_json_importer.js";
import { AzgaarImportWorkerClient } from "./azgaar_import_worker_client.js";
import type { AzgaarImportConfig } from "./azgaar_macro_world_source.js";

type Listener = (event: unknown) => void;

class MockWorker {
  static instances: MockWorker[] = [];
  static throwOnConstruct = false;

  private listeners = new Map<string, Listener[]>();
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    if (MockWorker.throwOnConstruct) {
      throw new Error("worker construction failed");
    }
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const workerGlobal = globalThis as unknown as Record<string, unknown>;
const hadOriginalWorker = "Worker" in workerGlobal;
const originalWorker = workerGlobal.Worker;

const config: AzgaarImportConfig = {
  map: { tileSize: 2 },
  import: { azgaarAtlasLongEdge: 2 },
  terrain: { minHeight: -16, maxHeight: 48 },
  world: { seaLevel: 18 },
};

function document(): AzgaarFullJsonDocument {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      mapName: "Worker Test",
      width: 100,
      height: 100,
      seed: "worker-test",
    },
    grid: {
      cellsX: 1,
      cellsY: 1,
      cells: [{ i: 0, h: 50 }],
    },
    pack: {
      cells: [{ i: 0, g: 0, h: 50, biome: 1 }],
    },
  };
}

function currentWorker(): MockWorker {
  const worker = MockWorker.instances.at(-1);
  if (!worker) throw new Error("mock Azgaar worker was not created");
  return worker;
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWorker.instances.length = 0;
  MockWorker.throwOnConstruct = false;
  workerGlobal.Worker = MockWorker as unknown as typeof Worker;
});

afterAll(() => {
  if (hadOriginalWorker) workerGlobal.Worker = originalWorker;
  else delete workerGlobal.Worker;
});

describe("AzgaarImportWorkerClient", () => {
  it("resolves a valid worker response", async () => {
    const client = new AzgaarImportWorkerClient();
    const worker = currentWorker();
    const source = document();
    const expected = importAzgaarFullJson(source, config);
    const pending = client.convert(source, config);
    const request = worker.postMessage.mock.calls[0]?.[0] as { id: number };

    worker.emit("message", { data: { id: request.id, world: expected } } as MessageEvent);

    await expect(pending).resolves.toEqual(expected);
    expect(worker.terminate).not.toHaveBeenCalled();
    client.dispose();
  });

  it("falls back when worker construction fails", async () => {
    MockWorker.throwOnConstruct = true;
    const client = new AzgaarImportWorkerClient();

    await expect(client.convert(document(), config)).resolves.toMatchObject({
      format: "azgaar-imported-v1",
      version: 1,
    });
  });

  it("rejects pending work and falls back after a worker crash", async () => {
    const client = new AzgaarImportWorkerClient();
    const worker = currentWorker();
    const pending = client.convert(document(), config);

    worker.emit("error", { message: "worker exploded" } as ErrorEvent);

    await expect(pending).rejects.toThrow("worker exploded");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(client.convert(document(), config)).resolves.toMatchObject({
      format: "azgaar-imported-v1",
      version: 1,
    });
  });

  it("fails closed when postMessage throws", async () => {
    const client = new AzgaarImportWorkerClient();
    const worker = currentWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("structured clone failed");
    });

    await expect(client.convert(document(), config)).rejects.toThrow("postMessage failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(client.convert(document(), config)).resolves.toMatchObject({
      format: "azgaar-imported-v1",
      version: 1,
    });
  });

  it("fails closed on an invalid worker response", async () => {
    const client = new AzgaarImportWorkerClient();
    const worker = currentWorker();
    const pending = client.convert(document(), config);
    const request = worker.postMessage.mock.calls[0]?.[0] as { id: number };

    worker.emit("message", { data: { id: request.id, world: {} } } as MessageEvent);

    await expect(pending).rejects.toThrow("invalid protocol message");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
