import { describe, expect, it } from "vitest";
import { ConstructionCollapseQueue } from "./construction_collapse_queue.js";

describe("ConstructionCollapseQueue", () => {
  it("delays and budgets collapse work deterministically", () => {
    const queue = new ConstructionCollapseQueue();
    queue.schedule("b", 0, 50);
    queue.schedule("a", 0, 50);
    queue.schedule("c", 0, 100);

    expect(queue.takeReady(49, 10)).toEqual([]);
    expect(queue.takeReady(50, 1)).toEqual(["a"]);
    expect(queue.takeReady(50, 10)).toEqual(["b"]);
    expect(queue.takeReady(100, 10)).toEqual(["c"]);
  });
});
