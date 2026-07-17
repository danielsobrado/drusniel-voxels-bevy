import { describe, expect, it } from "vitest";
import { ConstructionSupportGraph } from "./construction_support_graph.js";

describe("ConstructionSupportGraph", () => {
  it("stores bidirectional edges and dirties neighbours on removal", () => {
    const graph = new ConstructionSupportGraph();
    for (const id of ["left", "bridge", "right"]) graph.addNode(id);
    graph.connect("left", "bridge");
    graph.connect("bridge", "right");

    expect(graph.neighbors("bridge")).toEqual(["left", "right"]);
    expect(graph.removeNode("bridge")).toEqual(["left", "right"]);
    expect(graph.neighbors("left")).toEqual([]);
    expect(graph.takeDirtyStarts()).toEqual(["left", "right"]);
  });

  it("collects only the dirty connected island", () => {
    const graph = new ConstructionSupportGraph();
    for (const id of ["a", "b", "c", "remote"]) graph.addNode(id);
    graph.connect("a", "b");
    graph.connect("b", "c");

    expect(graph.collectIsland("a", 16)).toEqual({ ids: ["a", "b", "c"], exceededLimit: false });
    expect(graph.collectIsland("remote", 16)).toEqual({ ids: ["remote"], exceededLimit: false });
  });
});
