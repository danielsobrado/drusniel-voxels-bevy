import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./meadow_material.ts", import.meta.url), "utf8");

describe("meadow sunbeam mask wiring", () => {
  it("applies visual amount and GPU sun visibility in the WebGL shader", () => {
    expect(SOURCE).toContain("* uStrength * uVisualAmount * visibility * forwardScatter * localMist");
  });

  it("applies the same visual amount and GPU sun visibility in the WebGPU node material", () => {
    expect(SOURCE).toContain(".mul(uVisualAmount).mul(visibility).mul(forwardScatter).mul(localMist)");
  });

  it("updates amount, cold blend, and local mist for both material paths", () => {
    expect(SOURCE.match(/environment\.amount/g)?.length).toBe(2);
    expect(SOURCE.match(/environment\.coldBlend/g)?.length).toBe(2);
    expect(SOURCE.match(/environment\.localMist/g)?.length).toBe(2);
  });
});
