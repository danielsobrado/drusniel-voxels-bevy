import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { selectClodCut } from "../runtime/clodSelection.js";
import type { ClodPageNodeRuntime, ClodNodeId, ClodCut, ClodSelectionConfig } from "../runtime/clodRuntimeTypes.js";

function makeNode(
  id: string,
  level: number,
  footprint: { minX: number; minZ: number; maxX: number; maxZ: number },
  childIds: ClodNodeId[] = [],
  errorWorld = 1,
  ready = true,
): ClodPageNodeRuntime {
  const cx = (footprint.minX + footprint.maxX) / 2;
  const cz = (footprint.minZ + footprint.maxZ) / 2;
  const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) / 2;
  return {
    id,
    level,
    parentId: null,
    childIds,
    footprint,
    boundingSphere: { center: [cx, 0, cz], radius },
    errorWorld,
    minY: -1,
    maxY: 1,
    mesh: null,
    lowBenefit: false,
    ready,
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 10, 100);
  cam.lookAt(32, 0, 32);
  return cam;
}

const defaultConfig: ClodSelectionConfig = {
  errorThresholdPx: 5,
  hysteresisMergeFactor: 1.5,
  neighborLevelDeltaMax: 1,
};

describe("clodSelection", () => {
  it("selects root when error under threshold (camera far away)", () => {
    const childIds = ["L0:0,0", "L0:1,0", "L0:0,1", "L0:1,1"];
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    const root = makeNode("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }, childIds, 0.5);
    nodes.set("L1:0,0", root);
    for (const cid of childIds) {
      const parts = cid.split(":")[1].split(",");
      const cx = parseInt(parts[0]) * 32;
      const cz = parseInt(parts[1]) * 32;
      nodes.set(cid, makeNode(cid, 0, { minX: cx, minZ: cz, maxX: cx + 32, maxZ: cz + 32 }, [], 0.1));
    }

    const result = selectClodCut({
      rootNodeIds: ["L1:0,0"],
      nodes,
      previousCut: null,
      camera: makeCamera(),
      viewportHeightPx: 720,
      config: { ...defaultConfig, errorThresholdPx: 100 },
      freezeSelection: false,
      enforce21: false,
    });

    expect(result.cut.nodes.has("L1:0,0")).toBe(true);
    expect(result.cut.nodes.size).toBe(1);
  });

  it("selects children when error over threshold (camera close)", () => {
    const childIds = ["L0:0,0", "L0:1,0", "L0:0,1", "L0:1,1"];
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L1:0,0", makeNode("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }, childIds, 10));
    for (const cid of childIds) {
      const parts = cid.split(":")[1].split(",");
      const cx = parseInt(parts[0]) * 32;
      const cz = parseInt(parts[1]) * 32;
      nodes.set(cid, makeNode(cid, 0, { minX: cx, minZ: cz, maxX: cx + 32, maxZ: cz + 32 }, [], 1));
    }

    const cam = makeCamera();
    cam.position.set(32, 5, 32);

    const result = selectClodCut({
      rootNodeIds: ["L1:0,0"],
      nodes,
      previousCut: null,
      camera: cam,
      viewportHeightPx: 720,
      config: { ...defaultConfig, errorThresholdPx: 0.5 },
      freezeSelection: false,
      enforce21: false,
    });

    expect(result.cut.nodes.has("L1:0,0")).toBe(false);
    for (const cid of childIds) {
      expect(result.cut.nodes.has(cid)).toBe(true);
    }
    expect(result.cut.nodes.size).toBe(4);
  });

  it("parent fallback when children missing", () => {
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L1:0,0", makeNode("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }, ["L0:0,0"], 10, true));
    nodes.set("L0:0,0", makeNode("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 }, [], 1, false));

    const cam = makeCamera();
    cam.position.set(32, 5, 32);

    const result = selectClodCut({
      rootNodeIds: ["L1:0,0"],
      nodes,
      previousCut: null,
      camera: cam,
      viewportHeightPx: 720,
      config: { ...defaultConfig, errorThresholdPx: 0.5 },
      freezeSelection: false,
      enforce21: false,
    });

    expect(result.cut.nodes.has("L1:0,0")).toBe(true);
  });

  it("no parent/child duplicate in final cut", () => {
    const childIds = ["L0:0,0", "L0:1,0", "L0:0,1", "L0:1,1"];
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L1:0,0", makeNode("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }, childIds, 10));
    for (const cid of childIds) {
      const parts = cid.split(":")[1].split(",");
      const cx = parseInt(parts[0]) * 32;
      const cz = parseInt(parts[1]) * 32;
      nodes.set(cid, makeNode(cid, 0, { minX: cx, minZ: cz, maxX: cx + 32, maxZ: cz + 32 }, [], 1));
    }

    const cam = makeCamera();
    cam.position.set(32, 5, 32);

    const result = selectClodCut({
      rootNodeIds: ["L1:0,0"],
      nodes,
      previousCut: null,
      camera: cam,
      viewportHeightPx: 720,
      config: { ...defaultConfig, errorThresholdPx: 0.5 },
      freezeSelection: false,
      enforce21: false,
    });

    const hasParentAndChild = result.cut.nodes.has("L1:0,0") && childIds.some((id) => result.cut.nodes.has(id));
    expect(hasParentAndChild).toBe(false);
  });

  it("freeze keeps node IDs stable", () => {
    const nodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
    nodes.set("L1:0,0", makeNode("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }, [], 1));

    const previousCut: ClodCut = {
      frame: 10,
      nodes: new Map([["L1:0,0", { nodeId: "L1:0,0", level: 1, errorPx: 0.5, distanceToCamera: 50, reason: "accepted" }]]),
    };

    const cam = makeCamera();
    cam.position.set(1000, 500, 1000);

    const result = selectClodCut({
      rootNodeIds: ["L1:0,0"],
      nodes,
      previousCut,
      camera: cam,
      viewportHeightPx: 720,
      config: defaultConfig,
      freezeSelection: true,
      enforce21: false,
    });

    expect(result.cut.nodes.has("L1:0,0")).toBe(true);
    expect(result.cut.nodes.size).toBe(1);
  });
});
