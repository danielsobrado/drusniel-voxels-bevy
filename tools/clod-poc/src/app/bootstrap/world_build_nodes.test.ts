import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClodPageNode } from "../../types.js";
import { splitWorldBuildNodes } from "./world_build_nodes.js";

const bootstrapDir = dirname(fileURLToPath(import.meta.url));

function readSource(name: string): string {
  return readFileSync(resolve(bootstrapDir, name), "utf8");
}

function page(level: number, id: string): ClodPageNode {
  return { level, id } as ClodPageNode;
}

describe("splitWorldBuildNodes", () => {
  it("returns only LOD0 pages in lod0Nodes", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>([
      [0, [page(0, "L0:a"), page(0, "L0:b")]],
      [1, [page(1, "L1:c")]],
      [2, [page(2, "L2:d")]],
    ]);

    const { lod0Nodes, allNodes } = splitWorldBuildNodes(nodesByLevel);

    expect(lod0Nodes.map((n) => n.id)).toEqual(["L0:a", "L0:b"]);
    expect(lod0Nodes.every((n) => n.level === 0)).toBe(true);
    expect(allNodes.map((n) => n.id)).toEqual(["L0:a", "L0:b", "L1:c", "L2:d"]);
    expect(allNodes.length).toBeGreaterThan(lod0Nodes.length);
  });

  it("returns empty lod0Nodes when level 0 is missing", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>([
      [1, [page(1, "L1:a")]],
    ]);

    const { lod0Nodes, allNodes } = splitWorldBuildNodes(nodesByLevel);

    expect(lod0Nodes).toEqual([]);
    expect(allNodes.map((n) => n.id)).toEqual(["L1:a"]);
  });

  it("returns empty lists for an empty build", () => {
    const { lod0Nodes, allNodes } = splitWorldBuildNodes(new Map());
    expect(lod0Nodes).toEqual([]);
    expect(allNodes).toEqual([]);
  });
});

describe("lod0Nodes / allNodes bootstrap wiring", () => {
  it("world_build_startup builds terrain summary from lod0Nodes only", () => {
    const source = readSource("world_build_startup.ts");
    expect(source).toContain("splitWorldBuildNodes(result.nodesByLevel)");
    expect(source).toMatch(/buildTerrainSummary\(\s*lod0Nodes\s*,/);
    expect(source).not.toMatch(/buildTerrainSummary\(\s*allNodes\s*,/);
  });

  it("clod_poc_bootstrap routes allNodes to terrain view and lod0Nodes to runtime vegetation", () => {
    const source = readSource("clod_poc_bootstrap.ts");

    const terrainViewCall = source.match(/runTerrainViewStartup\(\{[\s\S]*?\n  \}\);/)?.[0] ?? "";
    expect(terrainViewCall).toContain("allNodes: world.allNodes");
    expect(terrainViewCall).not.toContain("lod0Nodes");

    const runtimeCall = source.match(/runRuntimeSystemsStartup\(\{[\s\S]*?\n  \}\);/)?.[0] ?? "";
    expect(runtimeCall).toContain("lod0Nodes: world.lod0Nodes");
    expect(runtimeCall).not.toContain("allNodes:");

    expect(source).toMatch(/runRendererStartup\(\{[\s\S]*?lod0Nodes: world\.lod0Nodes/);
  });

  it("each vegetation sub-startup passes lod0Nodes to its controller", () => {
    const checks: [string, string][] = [
      ["grass_startup", "createGrassController"],
      ["stone_startup", "createStoneController"],
      ["tree_startup", "createTreeController"],
      ["understory_startup", "createUnderstoryController"],
    ];
    for (const [file, func] of checks) {
      const source = readSource(`../../runtime/vegetation/${file}.ts`);
      const block = source.match(new RegExp(`${func}\\(\\{[\\s\\S]*?\\n  \\}\\)`))?.[0] ?? "";
      expect(block, `${func} in ${file} should use lod0Nodes`).toContain("nodes: lod0Nodes");
      expect(block, `${func} in ${file} must not use allNodes`).not.toContain("allNodes");
    }
  });

  it("water_startup keeps water on lod0Nodes", () => {
    const source = readSource("../../runtime/water_weather/water_startup.ts");
    expect(source).toContain("nodes: lod0Nodes");
    expect(source).not.toContain("allNodes");
  });
});
