import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./compute.ts", import.meta.url), "utf8");
const shaderSource = readFileSync(new URL("./dressing.compute.wgsl", import.meta.url), "utf8");

describe("dressing exclusion layout", () => {
  it("keeps the 24-word CPU uniform aligned with six WGSL vec4 fields", () => {
    expect(computeSource).toContain("const PARAM_WORDS = 24");
    expect(shaderSource).toContain("exclusion_meta: vec4<u32>");
    expect(shaderSource.match(/center_radius|settings|hydro_atlas|canopy_meta|category_ranges|exclusion_meta/g)).toHaveLength(6);
  });
});
