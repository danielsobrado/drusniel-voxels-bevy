import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { createHydrologyTileRemoteBuilder } from "./hydrology_tile_worker_client.js";

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

beforeEach(() => {
  FakeWorker.latest = null;
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hydrology tile gravel config", () => {
  it("serializes explicit gravel field and bed settings", () => {
    const hydrology = cloneHydrologyConfig();
    hydrology.gravelBed.enabled = true;
    hydrology.gravelBed.maxElevationM = 0.43;
    const client = createHydrologyTileRemoteBuilder();
    const worker = FakeWorker.latest;

    client!.configure({
      terrainFieldConfig: null,
      fakeBodies: { carveTerrain: false, lakes: [], rivers: [] },
      tileSizeM: 256,
      tileRes: 64,
      drySentinelDepthM: 2,
      hydrologyGraph: null,
      hydrologyCarve: null,
      gravelBars: hydrology.gravelBars,
      gravelBed: hydrology.gravelBed,
    });

    expect(worker!.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "configure",
      gravelBars: hydrology.gravelBars,
      gravelBed: hydrology.gravelBed,
    }));
    expect((worker!.postMessage.mock.calls[0]![0] as { gravelBed: unknown }).gravelBed).not.toBe(hydrology.gravelBed);
  });
});
