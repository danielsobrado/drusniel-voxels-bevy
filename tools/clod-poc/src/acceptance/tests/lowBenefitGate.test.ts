import { describe, expect, it } from "vitest";
import { computeLowBenefitRates } from "../lowBenefitGate.js";
import type { ClodPageNode } from "../../types.js";

function makeNode(level: number, lowBenefit: boolean): ClodPageNode {
  const positions = new Float32Array(9);
  const normals = new Float32Array(9);
  const paintSlots = new Float32Array(3);
  const materialWeights = new Float32Array(12);
  for (let i = 0; i < 3; i++) {
    paintSlots[i] = 0;
    materialWeights[i * 4] = 1.0;
  }
  const indices = new Uint32Array([0, 1, 2]);

  return {
    id: `L${level}:0,0`,
    level,
    children: [],
    mesh: { positions, normals, paintSlots, materialWeights, materialWeightStride: 4, indices },
    footprint: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
    bounds: { center: [32, 0, 32], radius: 45, minY: -1, maxY: 1 },
    errorWorld: level * 0.1,
    lowBenefit,
  };
}

describe("computeLowBenefitRates", () => {
  it("level 1/2 under threshold passes", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, [makeNode(0, false)]);
    nodesByLevel.set(1, [makeNode(1, false), makeNode(1, false), makeNode(1, false), makeNode(1, false)]);
    nodesByLevel.set(2, [makeNode(2, false), makeNode(2, false), makeNode(2, false)]);
    nodesByLevel.set(3, [makeNode(3, true)]);

    const metrics = computeLowBenefitRates(nodesByLevel);
    expect(metrics.lowBenefitRateLevel1).toBe(0);
    expect(metrics.lowBenefitRateLevel2).toBe(0);
    expect(metrics.lowBenefitRateLevel3).toBe(1);
    expect(metrics.overallLowBenefitRate).toBe(1 / 9);
  });

  it("level 1 over threshold", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    const level1Nodes: ClodPageNode[] = [];
    for (let i = 0; i < 10; i++) {
      level1Nodes.push(makeNode(1, i < 3));
    }
    nodesByLevel.set(0, [makeNode(0, false)]);
    nodesByLevel.set(1, level1Nodes);

    const metrics = computeLowBenefitRates(nodesByLevel);
    expect(metrics.lowBenefitRateLevel1).toBe(0.3);
    expect(metrics.lowBenefitRateLevel1).toBeGreaterThanOrEqual(0.1);
  });

  it("level 3 high but levels 1-2 ok", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, [makeNode(0, false)]);
    nodesByLevel.set(1, [makeNode(1, false), makeNode(1, false), makeNode(1, false), makeNode(1, false)]);
    nodesByLevel.set(2, [makeNode(2, false), makeNode(2, false)]);
    nodesByLevel.set(3, [makeNode(3, true), makeNode(3, true), makeNode(3, true)]);

    const metrics = computeLowBenefitRates(nodesByLevel);
    expect(metrics.lowBenefitRateLevel1).toBe(0);
    expect(metrics.lowBenefitRateLevel2).toBe(0);
    expect(metrics.lowBenefitRateLevel3).toBe(1);
  });
});
