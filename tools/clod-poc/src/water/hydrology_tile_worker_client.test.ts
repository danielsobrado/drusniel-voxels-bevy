import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const tiles = [{ tileX: 1, tileZ: -2 }];

beforeEach(() => {
  FakeWorker.latest = null;
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hydrology tile worker lifecycle", () => {
  it("rejects pending and future builds after a worker crash", async () => {
    const client = createHydrologyTileRemoteBuilder();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();

    const pending = client!.build(tiles);
    worker!.onerror?.({ message: "boom" } as ErrorEvent);

    await expect(pending).rejects.toThrow("hydrology tile build worker crashed: boom");
    await expect(client!.build(tiles)).rejects.toThrow("hydrology tile build worker crashed: boom");
    expect(client!.available()).toBe(false);
    expect(worker!.terminate).toHaveBeenCalledOnce();

    client!.dispose();
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });

  it("fails terminally when posting a build request throws", async () => {
    const client = createHydrologyTileRemoteBuilder();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();
    worker!.postMessage.mockImplementationOnce(() => {
      throw new DOMException("could not clone", "DataCloneError");
    });

    await expect(client!.build(tiles)).rejects.toThrow(
      "hydrology tile build worker post failed: could not clone",
    );
    await expect(client!.build(tiles)).rejects.toThrow(
      "hydrology tile build worker post failed: could not clone",
    );
    expect(client!.available()).toBe(false);
    expect(worker!.postMessage).toHaveBeenCalledOnce();
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });

  it("does not advance configuration after a failed configure post", () => {
    const client = createHydrologyTileRemoteBuilder();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();
    worker!.postMessage.mockImplementationOnce(() => {
      throw new Error("channel closed");
    });

    expect(() => client!.configure({} as never)).toThrow(
      "hydrology tile build worker post failed: channel closed",
    );
    expect(client!.available()).toBe(false);
    client!.configure({} as never);
    expect(worker!.postMessage).toHaveBeenCalledOnce();
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed when the worker produces an unreadable message", async () => {
    const client = createHydrologyTileRemoteBuilder();
    const worker = FakeWorker.latest;
    expect(client).not.toBeNull();
    expect(worker).not.toBeNull();

    worker!.onmessageerror?.({} as MessageEvent);

    expect(client!.available()).toBe(false);
    await expect(client!.build(tiles)).rejects.toThrow(
      "hydrology tile build worker produced an unreadable message",
    );
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });
});
