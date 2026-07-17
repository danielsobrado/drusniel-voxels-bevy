import { describe, expect, it } from "vitest";
import { ConstructionSupportGraph } from "./construction_support_graph.js";
import {
  predictConstructionStability,
  propagatedConstructionSupport,
  shouldConstructionCollapse,
  solveConstructionStabilityIsland,
} from "./construction_stability.js";
import type { ConstructionStabilityConfig, ConstructionSupportProfile } from "./types.js";

const wood: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.06, horizontalDecay: 0.10, supportClass: "wood" };
const stone: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.10, horizontalDecay: 0.18, supportClass: "stone" };
const metal: ConstructionSupportProfile = { maxSupport: 1, verticalDecay: 0.03, horizontalDecay: 0.05, supportClass: "ground" };
const config = {
  enabled: true,
  collapseThreshold: 0.20,
  epsilon: 0.0001,
  maxIslandSize: 4096,
  maxCollapsesPerFrame: 16,
  collapseDelayMs: 300,
  connectionToleranceM: 0.08,
  materialProfiles: { wood, brick: stone, concrete: stone, marble: stone, tiles: stone, stone, metal, thatch: { ...wood, verticalDecay: 1, horizontalDecay: 1 } },
} satisfies ConstructionStabilityConfig;

describe("construction stability solver", () => {
  it("uses separate vertical and horizontal decay", () => {
    expect(propagatedConstructionSupport(1, wood, wood, "vertical")).toBeCloseTo(0.94);
    expect(propagatedConstructionSupport(1, wood, wood, "horizontal")).toBeCloseTo(0.90);
  });

  it("allows stronger classes to reset weaker targets but not the reverse", () => {
    expect(propagatedConstructionSupport(0.1, stone, wood, "horizontal")).toBe(1);
    expect(propagatedConstructionSupport(1, wood, stone, "vertical")).toBe(0);
    expect(propagatedConstructionSupport(0.1, metal, stone, "vertical")).toBe(1);
  });

  it("converges cycles to the strongest available path", () => {
    const graph = new ConstructionSupportGraph();
    for (const id of ["ground", "left", "right"]) graph.addNode(id);
    graph.connect("ground", "left");
    graph.connect("left", "right");
    graph.connect("right", "ground");
    const result = solveConstructionStabilityIsland(new Map([
      ["ground", { id: "ground", position: [0, 0, 0], profile: wood, grounded: true }],
      ["left", { id: "left", position: [2, 0, 0], profile: wood, grounded: false }],
      ["right", { id: "right", position: [0, 0, 2], profile: wood, grounded: false }],
    ]), graph, config.epsilon);

    expect(result.values.get("ground")).toBe(1);
    expect(result.values.get("left")).toBeCloseTo(0.9);
    expect(result.values.get("right")).toBeCloseTo(0.9);
  });

  it("predicts from the best of multiple independent supports", () => {
    const prediction = predictConstructionStability({
      grounded: false,
      position: [2, 0, 0],
      targetProfile: wood,
      connectedPieces: [
        { id: "weak", typeId: "x", position: [0, 0, 0], rotationQuarterTurns: 0, stability: 0.3, material: "wood" },
        { id: "strong", typeId: "x", position: [4, 0, 0], rotationQuarterTurns: 0, stability: 0.8, material: "wood" },
      ],
      profileForPiece: () => wood,
      config,
    });
    expect(prediction.value).toBeCloseTo(0.7);
    expect(prediction.connectionIds).toEqual(["strong", "weak"]);
    expect(prediction.supported).toBe(true);
  });

  it("queues only non-grounded pieces below the collapse threshold", () => {
    expect(shouldConstructionCollapse({ grounded: false, stability: 0.19 }, config)).toBe(true);
    expect(shouldConstructionCollapse({ grounded: false, stability: 0.20 }, config)).toBe(false);
    expect(shouldConstructionCollapse({ grounded: true, stability: 0 }, config)).toBe(false);
  });
});
