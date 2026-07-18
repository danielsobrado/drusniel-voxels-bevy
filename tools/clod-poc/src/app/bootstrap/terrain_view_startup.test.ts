import { describe, expect, it } from "vitest";
import { gpuMesherEnabledForScene } from "./terrain_view_startup.js";

describe("gpuMesherEnabledForScene", () => {
  it("defaults on for every streaming long-view scene", () => {
    expect(gpuMesherEnabledForScene("infinite-islands", new URLSearchParams())).toBe(true);
    expect(gpuMesherEnabledForScene("continent", new URLSearchParams())).toBe(true);
    expect(gpuMesherEnabledForScene("rpg-village", new URLSearchParams())).toBe(true);
  });

  it("stays off by default for bounded scenes", () => {
    expect(gpuMesherEnabledForScene("sanity", new URLSearchParams())).toBe(false);
  });

  it("honors explicit query overrides", () => {
    expect(gpuMesherEnabledForScene("rpg-village", new URLSearchParams("gpuMesh=0"))).toBe(false);
    expect(gpuMesherEnabledForScene("sanity", new URLSearchParams("gpuMesh=1"))).toBe(true);
  });
});
