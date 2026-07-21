import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const materialSource = readFileSync(new URL("./ground_debris_material.ts", import.meta.url), "utf8");
const atlasSource = readFileSync(
  new URL("../../../terrain/sun_visibility/sun_light_gpu_atlas_nodes.ts", import.meta.url),
  "utf8",
);

describe("ground debris far sun visibility", () => {
  it("samples the canonical shared GPU atlas at the instance world position", () => {
    expect(materialSource).toContain("buildSunLightGpuAtlasNodes");
    expect(materialSource).toContain("record.positionScale.xz");
    expect(materialSource).toContain(".visibility");
    expect(materialSource).not.toContain("new DataTexture");
    expect(materialSource).not.toContain("textureLoad");
  });

  it("keeps the visibility response restrained instead of replacing PBR lighting", () => {
    expect(materialSource).toContain("MIN_SUN_VISIBILITY_RESPONSE = 0.78");
    expect(materialSource).toContain("mix(");
    expect(materialSource).toContain("sunVisibility");
    expect(materialSource).toContain(".mul(sunResponse)");
    expect(materialSource).not.toContain("emissiveNode");
  });

  it("inherits the shared atlas fail-open policy", () => {
    expect(atlasSource).toContain("mix as (...args: TslNode[]) => TslNode)(float(1), sampled, knownSample)");
    expect(atlasSource).toContain("float(1), resolvedSample, atlasInside");
    expect(atlasSource).toContain("refs.valid");
  });

  it("introduces no readback or extra render pass", () => {
    expect(materialSource).not.toContain("mapAsync");
    expect(materialSource).not.toContain("getMappedRange");
    expect(materialSource).not.toContain("WebGLRenderTarget");
  });
});
