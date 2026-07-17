import { describe, expect, it } from "vitest";
import {
  constructionStabilityColorHex,
  propagatedConstructionSupport,
  solveConstructionStability,
  type ConstructionStabilityNode,
} from "./construction_stability.js";
import type { ConstructionSupportProfile } from "./types.js";

const WOOD: ConstructionSupportProfile = {
  maxSupport: 1,
  verticalDecay: 0.06,
  horizontalDecay: 0.10,
  supportClass: "wood",
};
const STONE: ConstructionSupportProfile = {
  maxSupport: 1,
  verticalDecay: 0.10,
  horizontalDecay: 0.18,
  supportClass: "stone",
};
const METAL: ConstructionSupportProfile = {
  maxSupport: 1,
  verticalDecay: 0.03,
  horizontalDecay: 0.05,
  supportClass: "ground",
};
const CONFIG = { epsilon: 0.0001, verticalConnectionMinRatio: 0.55 };

function solve(nodes: ConstructionStabilityNode[], edges: readonly [string, string][]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const [a, b] of edges) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  return solveConstructionStability(byId, (id) => adjacency.get(id) ?? [], CONFIG).values;
}

describe("construction stability propagation", () => {
  it("decays horizontal cantilevers faster than vertical stacks", () => {
    expect(propagatedConstructionSupport(1, WOOD, WOOD, true)).toBeCloseTo(0.94);
    expect(propagatedConstructionSupport(1, WOOD, WOOD, false)).toBeCloseTo(0.90);
  });

  it("lets stronger support classes fully support weaker pieces", () => {
    expect(propagatedConstructionSupport(0.4, STONE, WOOD, false)).toBe(1);
    expect(propagatedConstructionSupport(0.4, METAL, STONE, false)).toBe(1);
  });

  it("prevents weaker classes from carrying stronger pieces", () => {
    expect(propagatedConstructionSupport(1, WOOD, STONE, true)).toBe(0);
  });

  it("solves cycles through the strongest available path", () => {
    const values = solve([
      { id: "ground", position: [0, 0, 0], profile: WOOD, grounded: true },
      { id: "a", position: [2, 0, 0], profile: WOOD, grounded: false },
      { id: "b", position: [4, 0, 0], profile: WOOD, grounded: false },
      { id: "c", position: [2, 0, 2], profile: WOOD, grounded: false },
    ], [["ground", "a"], ["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(values.get("a")).toBeCloseTo(0.9);
    expect(values.get("b")).toBeCloseTo(0.8);
    expect(values.get("c")).toBeCloseTo(0.8);
  });

  it("uses the best of two bridge supports", () => {
    const values = solve([
      { id: "left", position: [0, 0, 0], profile: WOOD, grounded: true },
      { id: "mid-left", position: [2, 0, 0], profile: WOOD, grounded: false },
      { id: "center", position: [4, 0, 0], profile: WOOD, grounded: false },
      { id: "mid-right", position: [6, 0, 0], profile: WOOD, grounded: false },
      { id: "right", position: [8, 0, 0], profile: WOOD, grounded: true },
    ], [["left", "mid-left"], ["mid-left", "center"], ["center", "mid-right"], ["mid-right", "right"]]);
    expect(values.get("center")).toBeCloseTo(0.8);
    expect(values.get("mid-left")).toBeCloseTo(0.9);
    expect(values.get("mid-right")).toBeCloseTo(0.9);
  });

  it("maps grounded and weakening states to stable debug colors", () => {
    expect(constructionStabilityColorHex(1, 1, true, 0.2)).toBe(0x3380ff);
    expect(constructionStabilityColorHex(0.9, 1, false, 0.2)).toBe(0x35d46b);
    expect(constructionStabilityColorHex(0.5, 1, false, 0.2)).toBe(0xf2d83d);
    expect(constructionStabilityColorHex(0.25, 1, false, 0.2)).toBe(0xff8a1f);
    expect(constructionStabilityColorHex(0.1, 1, false, 0.2)).toBe(0xff3d3d);
  });
});
