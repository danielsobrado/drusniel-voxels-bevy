import { describe, expect, it } from "vitest";
import { resolveTerrainFieldConfig, setTerrainFieldConfig, baseSurfaceHeight } from "../../terrain/terrain_surface.js";
import { buildHydrologyGraph } from "./hydrology_graph_builder.js";

function heightField(res: number, values: readonly number[]): (x: number, z: number) => number {
  return (x, z) => values[Math.round(z) * res + Math.round(x)]!;
}

function expectGraphSemantics(graph: ReturnType<typeof buildHydrologyGraph>): void {
  const lakeIds = new Set(graph.lakes.map((lake) => lake.id));
  const riversById = new Map(graph.rivers.map((river) => [river.id, river]));
  for (const river of graph.rivers) {
    expect(river.vertices.length).toBeGreaterThan(0);
    for (let index = 1; index < river.vertices.length; index++) {
      expect(river.vertices[index]!.waterY).toBeLessThanOrEqual(river.vertices[index - 1]!.waterY);
      expect(river.vertices[index]!.discharge).toBeGreaterThanOrEqual(river.vertices[index - 1]!.discharge);
      expect(river.vertices[index]!.widthM).toBeGreaterThanOrEqual(river.vertices[index - 1]!.widthM);
    }
    if (river.terminalKind === "lake") expect(lakeIds.has(river.terminalLakeId!)).toBe(true);
    let terminal = river;
    const visited = new Set<string>();
    while (terminal.terminalKind === "river") {
      expect(terminal.downstreamRiverId).toBeDefined();
      expect(visited.has(terminal.id)).toBe(false);
      visited.add(terminal.id);
      terminal = riversById.get(terminal.downstreamRiverId!)!;
      expect(terminal).toBeDefined();
    }
    expect(["lake", "ocean", "terminal"]).toContain(terminal.terminalKind);
  }
  for (const lake of graph.lakes) {
    expect(lake.areaCells).toBeGreaterThan(0);
    expect(lake.maxDepthM).toBeGreaterThan(0);
    expect(lake.terminal || lake.outletCell >= 0).toBe(true);
  }
}

describe("continental hydrology graph builder", () => {
  it("fills a bowl into one lake with a deterministic spill", () => {
    const res = 5;
    const heights = [
      10, 10, 10, 10, 10,
      10, 6, 6, 6, 10,
      10, 6, 0, 6, 10,
      10, 6, 6, 6, 10,
      10, 10, 10, 10, 10,
    ];
    const graph = buildHydrologyGraph({
      worldId: "bowl",
      seed: 1,
      sizeM: { x: 4, z: 4 },
      sampleHeight: heightField(res, heights),
      config: { spacingM: 1, lakeMinDepthM: 0.01, channelThresholdCells: 2 },
    });

    expect(graph.lakes).toHaveLength(1);
    expect(graph.lakes[0]).toMatchObject({ levelM: 10, areaCells: 9, maxDepthM: 10 });
    expect(graph.macro.buildFields!.filledHeight[2 * res + 2]).toBe(10);
    expectGraphSemantics(graph);
  });

  it("routes a tilted plane into parallel downhill channels", () => {
    const graph = buildHydrologyGraph({
      worldId: "plane",
      seed: 2,
      sizeM: { x: 6, z: 6 },
      sampleHeight: (_x, z) => 100 - z * 10,
      config: { spacingM: 1, channelThresholdCells: 3 },
    });

    expect(graph.lakes).toHaveLength(0);
    expect(graph.rivers.length).toBeGreaterThanOrEqual(5);
    expect(new Set(graph.rivers.map((river) => river.vertices[0]!.x)).size).toBeGreaterThan(1);
    expect(graph.rivers.every((river) => river.terminalKind === "ocean" || river.terminalKind === "river")).toBe(true);
    expectGraphSemantics(graph);
  });

  it("keeps a saddle split into two terminal watersheds", () => {
    const graph = buildHydrologyGraph({
      worldId: "saddle",
      seed: 3,
      sizeM: { x: 6, z: 6 },
      sampleHeight: (x, z) => 40 - Math.abs(x - 3) * 5 + Math.abs(z - 3) * 2,
      config: { spacingM: 1, channelThresholdCells: 3 },
    });
    const oceanTerminals = graph.rivers.filter((river) => river.terminalKind === "ocean");
    expect(oceanTerminals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(oceanTerminals.map((river) => Math.sign(river.vertices.at(-1)!.x - 3))).size).toBe(2);
    expectGraphSemantics(graph);
  });

  it("is bit-deterministic for identical inputs", () => {
    const input = {
      worldId: "determinism",
      seed: 11,
      sizeM: { x: 64, z: 64 },
      sampleHeight: (x: number, z: number) => Math.sin(x * 0.2) * 8 + Math.cos(z * 0.17) * 5,
      config: { spacingM: 4, channelThresholdCells: 8 },
    };
    const first = buildHydrologyGraph(input);
    const second = buildHydrologyGraph(input);
    expect(new Uint8Array(second.macro.buildFields!.filledHeight.buffer)).toEqual(new Uint8Array(first.macro.buildFields!.filledHeight.buffer));
    expect(second.macro.buildFields!.downstream).toEqual(first.macro.buildFields!.downstream);
    expect(new Uint8Array(second.macro.buildFields!.accumulation.buffer)).toEqual(new Uint8Array(first.macro.buildFields!.accumulation.buffer));
    expect(second.rivers).toEqual(first.rivers);
    expect(second.lakes).toEqual(first.lakes);
  });

  it("builds a reduced real field with connected monotone records", () => {
    setTerrainFieldConfig(resolveTerrainFieldConfig({ seed: 19 }));
    const graph = buildHydrologyGraph({
      worldId: "real-4km",
      seed: 19,
      sizeM: { x: 4096, z: 4096 },
      sampleHeight: baseSurfaceHeight,
      config: { channelThresholdCells: 128 },
    });
    expect(graph.macro.resX).toBe(257);
    expect(graph.macro.resZ).toBe(257);
    expect(graph.rivers.length).toBeGreaterThan(0);
    expectGraphSemantics(graph);
    setTerrainFieldConfig(null);
  });
});
