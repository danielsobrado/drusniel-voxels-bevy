import { beforeAll, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  buildWorld: vi.fn(async () => ({})),
  buildHeightfieldTiles: vi.fn(),
  buildStreamRoots: vi.fn(async () => ({ nodes: [], buildMs: 0, transferBytes: 0 })),
  dispose: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../clod_worker_client.js", () => ({
  ClodWorkerClient: class {
    buildWorld(...args: unknown[]) {
      return (clientMocks.buildWorld as (...input: unknown[]) => Promise<unknown>)(...args);
    }

    buildHeightfieldTiles(...args: unknown[]) {
      return (clientMocks.buildHeightfieldTiles as (...input: unknown[]) => unknown)(...args);
    }

    buildStreamRoots(...args: unknown[]) {
      return (clientMocks.buildStreamRoots as (...input: unknown[]) => Promise<unknown>)(...args);
    }

    dispose(): void {
      clientMocks.dispose();
    }
  },
}));
vi.mock("./heightfield_tile_runtime.js", () => ({
  createHeightfieldTileRuntime: runtimeMocks.create,
}));
vi.mock("../../save/save_runtime.js", () => ({
  getSaveRuntimeFeatureStamps: vi.fn(() => null),
  subscribeSaveRuntimeFeatureStamps: vi.fn(),
}));

import { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  heightfieldTileBuildAllowed,
  heightfieldTilesReadyForPage,
  installHeightfieldTileClientRuntime,
} from "./heightfield_tile_client_runtime.js";

const requestedTileIds: string[] = [];
let client: ClodWorkerClient;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  runtimeMocks.create.mockResolvedValue({
    authoritative: true,
    cache: {
      get: ({ x, z }: { x: number; z: number }) => {
        requestedTileIds.push(`${x},${z}`);
        return {};
      },
    },
    update: vi.fn(),
    counters: vi.fn(),
    invalidateBounds: vi.fn(),
    dispose: vi.fn(),
  });
  installHeightfieldTileClientRuntime();
  client = new ClodWorkerClient();
  await (client.buildWorld as (...args: unknown[]) => Promise<unknown>)(...Array(14).fill(null));
});

function idleCounters(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    live_clod_stream_required_pages: 4,
    live_clod_stream_ready_pages: 4,
    live_clod_stream_pending_pages: 0,
    live_clod_stream_inflight_batches: 0,
    live_clod_stream_apply_queue_pages: 0,
    live_clod_stream_safety_pending_pages: 0,
    live_clod_stream_safety_inflight_pages: 0,
    ...overrides,
  };
}

describe("heightfieldTilesReadyForPage", () => {
  it.each([
    ["large positive origin", 127, 127],
    ["large negative origin", -128, -128],
    ["small origin", 0, 0],
  ])("uses half-open tile bounds at a %s", (_name, pageCoord, expectedTileCoord) => {
    requestedTileIds.length = 0;

    expect(heightfieldTilesReadyForPage(
      client,
      { px: pageCoord, pz: pageCoord, level: 2 },
      64,
    )).toBe(true);
    expect(requestedTileIds).toEqual([`${expectedTileCoord},${expectedTileCoord}`]);
  });
});

describe("stream-root cache request scope", () => {
  it("keeps the wrapped worker result unchanged", async () => {
    await expect(client.buildStreamRoots([{ px: 1, pz: 2 }])).resolves.toEqual({
      nodes: [],
      buildMs: 0,
      transferBytes: 0,
    });
    expect(clientMocks.buildStreamRoots).toHaveBeenCalledWith([{ px: 1, pz: 2 }]);
  });
});

describe("heightfieldTileBuildAllowed", () => {
  it("blocks until streamed-root counters exist", () => {
    expect(heightfieldTileBuildAllowed(undefined)).toBe(false);
    expect(heightfieldTileBuildAllowed({})).toBe(false);
    expect(heightfieldTileBuildAllowed({ live_clod_stream_required_pages: 4 })).toBe(false);
  });

  it("blocks before required streamed roots are ready", () => {
    expect(heightfieldTileBuildAllowed(idleCounters({ live_clod_stream_ready_pages: 0 }))).toBe(false);
  });

  it.each([
    "live_clod_stream_pending_pages",
    "live_clod_stream_inflight_batches",
    "live_clod_stream_apply_queue_pages",
    "live_clod_stream_safety_pending_pages",
    "live_clod_stream_safety_inflight_pages",
  ])("blocks while %s is non-zero", (key) => {
    expect(heightfieldTileBuildAllowed(idleCounters({ [key]: 1 }))).toBe(false);
  });

  it("allows builds after streamed-root queues drain", () => {
    expect(heightfieldTileBuildAllowed(idleCounters())).toBe(true);
    expect(heightfieldTileBuildAllowed(idleCounters({
      live_clod_stream_required_pages: 0,
      live_clod_stream_ready_pages: 0,
    }))).toBe(true);
  });
});
