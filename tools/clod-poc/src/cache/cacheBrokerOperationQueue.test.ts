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

    const write = queue.enqueue(async () => {
      order.push("write-start");
      await releaseWrite.promise;
      order.push("write-end");
    });
    const clear = queue.enqueue(async () => {
      order.push("clear");
    });

    await Promise.resolve();
    expect(order).toEqual(["write-start"]);
    releaseWrite.resolve();
    await Promise.all([write, clear]);
    expect(order).toEqual(["write-start", "write-end", "clear"]);
  });

  it("continues after a failed operation", async () => {
    const queue = new CacheBrokerOperationQueue();
    const first = queue.enqueue(async () => {
      throw new Error("expected");
    });
    const second = queue.enqueue(async () => "completed");

    await expect(first).rejects.toThrow("expected");
    await expect(second).resolves.toBe("completed");
  });
});
