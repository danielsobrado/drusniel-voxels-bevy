import { describe, expect, it } from "vitest";
import nodeSource from "./water_far_reflection_node.ts?raw";

describe("water far reflection TSL source", () => {
  it("uses storage-backed world marching without screen-space depth reads", () => {
    expect(nodeSource).toContain('storage(gpu.attribute, "vec4", maxCells)');
    expect(nodeSource).toContain("Loop(uMaxSteps.toUint()");
    expect(nodeSource).toContain("source.element(index)");
    expect(nodeSource).toContain("index = cell.y.mul(uResolution).add(cell.x).toUint()");
    expect(nodeSource).not.toContain("viewportDepthTexture");
    expect(nodeSource).not.toContain("viewportSharedTexture");
  });

  it("fails closed when live source topology differs from the compiled storage size", () => {
    expect(nodeSource).toContain("next.sourceResolution === storageResolution");
    expect(nodeSource).toContain("topologyMatches && waterFarSummaryReflectionActive");
  });
});
