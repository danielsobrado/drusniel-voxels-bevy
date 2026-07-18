import { describe, expect, it } from "vitest";
import { CacheBrokerOperationQueue } from "./cacheBrokerOperationQueue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("CacheBrokerOperationQueue", () => {
  it("keeps clear-like barriers behind earlier writes", async () => {
    const queue = new CacheBrokerOperationQueue();
    const releaseWrite = deferred();
    const order: string[] = [];

    const write = queue.run(async () => {
      order.push("write-start");
      await releaseWrite.promise;
      order.push("write-end");
    });
    const clear = queue.barrier(async () => {
      order.push("clear");
    });

    await Promise.resolve();
    expect(order).toEqual(["write-start"]);
    releaseWrite.resolve();
    await Promise.all([write, clear]);
    expect(order).toEqual(["write-start", "write-end", "clear"]);
  });

  it("keeps operations after a barrier behind that barrier", async () => {
    const queue = new CacheBrokerOperationQueue();
    const releaseBarrier = deferred();
    const order: string[] = [];

    const clear = queue.barrier(async () => {
      order.push("clear-start");
      await releaseBarrier.promise;
      order.push("clear-end");
    });
    const read = queue.run(async () => {
      order.push("read");
    });

    await Promise.resolve();
    expect(order).toEqual(["clear-start"]);
    releaseBarrier.resolve();
    await Promise.all([clear, read]);
    expect(order).toEqual(["clear-start", "clear-end", "read"]);
  });

  it("does not serialize normal cache operations", async () => {
    const queue = new CacheBrokerOperationQueue();
    const release = deferred();
    const started: string[] = [];

    const first = queue.run(async () => {
      started.push("first");
      await release.promise;
    });
    const second = queue.run(async () => {
      started.push("second");
      await release.promise;
    });

    await Promise.resolve();
    expect(started.sort()).toEqual(["first", "second"]);
    release.resolve();
    await Promise.all([first, second]);
  });

  it("continues after a failed operation", async () => {
    const queue = new CacheBrokerOperationQueue();
    const first = queue.run(async () => {
      throw new Error("expected");
    });
    const second = queue.run(async () => "completed");

    await expect(first).rejects.toThrow("expected");
    await expect(second).resolves.toBe("completed");
  });
});
