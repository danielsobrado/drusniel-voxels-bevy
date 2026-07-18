import { describe, expect, it, vi } from "vitest";
import {
  installClodWorkerProtocolGuard,
  isClodWorkerProtocolMessage,
} from "./clod_worker_protocol_guard.js";

class MockWorker {
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onerror = vi.fn();

  addEventListener(type: "message" | "messageerror", listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: "message" | "messageerror", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe("CLOD worker protocol guard", () => {
  it("accepts cache RPC and valid CLOD response envelopes", () => {
    expect(isClodWorkerProtocolMessage({ type: "cacheRpc", requestId: 1, op: "probe" })).toBe(true);
    expect(isClodWorkerProtocolMessage({ type: "flushed", requestId: 2 })).toBe(true);
    expect(isClodWorkerProtocolMessage({
      type: "streamRootsBuilt",
      requestId: 3,
      nodes: [],
      buildMs: 1,
      transferBytes: 0,
    })).toBe(true);
  });

  it("rejects unknown and incomplete response envelopes", () => {
    expect(isClodWorkerProtocolMessage(null)).toBe(false);
    expect(isClodWorkerProtocolMessage({ type: "futureResponse", requestId: 1 })).toBe(false);
    expect(isClodWorkerProtocolMessage({ type: "flushed" })).toBe(false);
    expect(isClodWorkerProtocolMessage({
      type: "heightfieldTilesBuilt",
      requestId: 1,
      tiles: [],
      buildMs: Number.NaN,
    })).toBe(false);
  });

  it("reports invalid worker messages through the terminal error handler", () => {
    const worker = new MockWorker();
    installClodWorkerProtocolGuard(worker);

    worker.emit("message", { type: "unknownResponse", requestId: 4 });

    expect(worker.onerror).toHaveBeenCalledTimes(1);
    expect((worker.onerror.mock.calls[0]![0] as ErrorEvent).message).toContain("invalid protocol message");
  });

  it("reports structured-clone failures through the terminal error handler", () => {
    const worker = new MockWorker();
    installClodWorkerProtocolGuard(worker);

    worker.emit("messageerror");

    expect(worker.onerror).toHaveBeenCalledTimes(1);
    expect((worker.onerror.mock.calls[0]![0] as ErrorEvent).message).toContain("could not be deserialized");
  });

  it("installs only one guard per worker", () => {
    const worker = new MockWorker();
    installClodWorkerProtocolGuard(worker);
    installClodWorkerProtocolGuard(worker);

    expect(worker.listeners.get("message")).toHaveLength(1);
    expect(worker.listeners.get("messageerror")).toHaveLength(1);
  });
});
