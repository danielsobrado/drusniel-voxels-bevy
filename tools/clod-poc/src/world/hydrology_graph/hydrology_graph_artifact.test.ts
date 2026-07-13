import { describe, expect, it } from "vitest";
import { buildHydrologyGraph } from "./hydrology_graph_builder.js";
import { computeHydrologyGraphArtifactHash, createHydrologyGraphArtifact } from "./hydrology_graph_artifact.js";

describe("hydrology graph artifact", () => {
  it("has a stable content hash that changes with graph data", async () => {
    const graph = buildHydrologyGraph({
      worldId: "hash",
      seed: 8,
      sizeM: { x: 16, z: 16 },
      sampleHeight: (x, z) => x * 0.5 + z,
      config: { spacingM: 2, channelThresholdCells: 3 },
    });
    const first = await computeHydrologyGraphArtifactHash(graph);
    const second = await createHydrologyGraphArtifact(graph, 12);
    expect(second.ref.hash).toBe(first);
    graph.macro.lakeIndex[0] += 1;
    expect(await computeHydrologyGraphArtifactHash(graph)).not.toBe(first);
  });
});
