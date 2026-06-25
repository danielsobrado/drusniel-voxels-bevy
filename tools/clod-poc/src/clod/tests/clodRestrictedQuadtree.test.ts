import { describe, expect, it } from "vitest";
import { enforceRestrictedQuadtree } from "../runtime/clodRestrictedQuadtree.js";
import type { ClodPageNodeRuntime, ClodNodeId, ClodCut, ClodSelectedNode } from "../runtime/clodRuntimeTypes.js";

function makeNode(
  id: string,
  level: number,
  footprint: { minX: number; minZ: number; maxX: number; maxZ: number },
  childIds: ClodNodeId[] = [],
  ready = true,
): ClodPageNodeRuntime {
  return {
    id,
    level,
    parentId: null,
    childIds,
    footprint,
    boundingSphere: { center: [(footprint.minX + footprint.maxX) / 2, 0, (footprint.minZ + footprint.maxZ) / 2], radius: 1 },
    errorWorld: 1,
    minY: -1,
    maxY: 1,
    mesh: null,
    lowBenefit: false,
    ready,
  };
}

function cutNode(nodeId: string, level: number): ClodSelectedNode {
  return { nodeId, level, errorPx: 0, distanceToCamera: 0, reason: "accepted" };
}

describe("clodRestrictedQuadtree", () => {
  it("accepts neighbor level delta 1", () => {
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L0:0,0", makeNode("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 8, maxZ: 8 }));
    nodes.set("L1:1,0", makeNode("L1:1,0", 1, { minX: 8, minZ: 0, maxX: 16, maxZ: 8 }));

    const cut: ClodCut = {
      frame: 0,
      nodes: new Map([
        ["L0:0,0", cutNode("L0:0,0", 0)],
        ["L1:1,0", cutNode("L1:1,0", 1)],
      ]),
    };

    const result = enforceRestrictedQuadtree({ cut, nodes, maxLevelDelta: 1 });
    expect(result.forcedSplits).toBe(0);
    expect(result.blockedSplits).toBe(0);
    expect(result.cut.nodes.size).toBe(2);
  });

  it("splits coarse node at delta 2 when children available", () => {
    const childIds = ["L0:2,0", "L0:3,0", "L0:2,1", "L0:3,1"];
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L2:1,0", makeNode("L2:1,0", 2, { minX: 8, minZ: 0, maxX: 24, maxZ: 8 }, childIds, true));
    for (const cid of childIds) {
      const parts = cid.split(":")[1].split(",");
      const cx = parseInt(parts[0]) * 4;
      const cz = parseInt(parts[1]) * 4;
      nodes.set(cid, makeNode(cid, 0, { minX: cx, minZ: cz, maxX: cx + 4, maxZ: cz + 4 }));
    }
    nodes.set("L0:0,0", makeNode("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 8, maxZ: 8 }));

    const cut: ClodCut = {
      frame: 0,
      nodes: new Map([
        ["L2:1,0", cutNode("L2:1,0", 2)],
        ["L0:0,0", cutNode("L0:0,0", 0)],
      ]),
    };

    const result = enforceRestrictedQuadtree({ cut, nodes, maxLevelDelta: 1 });
    expect(result.forcedSplits).toBe(1);
    expect(result.cut.nodes.has("L2:1,0")).toBe(false);
  });

  it("blocks split when children missing and increments blocked count", () => {
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L2:1,0", makeNode("L2:1,0", 2, { minX: 8, minZ: 0, maxX: 24, maxZ: 8 }, ["L0:4,0", "L0:5,0", "L0:4,1", "L0:5,1"], true));
    nodes.set("L0:4,0", makeNode("L0:4,0", 0, { minX: 8, minZ: 0, maxX: 12, maxZ: 4 }, [], true));
    nodes.set("L0:5,0", makeNode("L0:5,0", 0, { minX: 12, minZ: 0, maxX: 16, maxZ: 4 }, [], true));
    nodes.set("L0:4,1", makeNode("L0:4,1", 0, { minX: 8, minZ: 4, maxX: 12, maxZ: 8 }, [], true));
    nodes.set("L0:0,0", makeNode("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 8, maxZ: 8 }));

    const cut: ClodCut = {
      frame: 0,
      nodes: new Map([
        ["L2:1,0", cutNode("L2:1,0", 2)],
        ["L0:0,0", cutNode("L0:0,0", 0)],
      ]),
    };

    const result = enforceRestrictedQuadtree({ cut, nodes, maxLevelDelta: 1 });
    expect(result.forcedSplits).toBe(0);
    expect(result.blockedSplits).toBe(1);
    expect(result.cut.nodes.has("L2:1,0")).toBe(true);
  });

  it("pass terminates for valid cut", () => {
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L0:0,0", makeNode("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 8, maxZ: 8 }));
    nodes.set("L0:1,0", makeNode("L0:1,0", 0, { minX: 8, minZ: 0, maxX: 16, maxZ: 8 }));
    nodes.set("L0:0,1", makeNode("L0:0,1", 0, { minX: 0, minZ: 8, maxX: 8, maxZ: 16 }));
    nodes.set("L0:1,1", makeNode("L0:1,1", 0, { minX: 8, minZ: 8, maxX: 16, maxZ: 16 }));

    const cut: ClodCut = {
      frame: 0,
      nodes: new Map([
        ["L0:0,0", cutNode("L0:0,0", 0)],
        ["L0:1,0", cutNode("L0:1,0", 0)],
        ["L0:0,1", cutNode("L0:0,1", 0)],
        ["L0:1,1", cutNode("L0:1,1", 0)],
      ]),
    };

    const result = enforceRestrictedQuadtree({ cut, nodes, maxLevelDelta: 1 });
    expect(result.forcedSplits).toBe(0);
    expect(result.blockedSplits).toBe(0);
    expect(result.cut.nodes.size).toBe(4);
  });
});
