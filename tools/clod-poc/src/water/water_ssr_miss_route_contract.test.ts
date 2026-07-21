import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("./water_ssr_miss_route.ts", import.meta.url), "utf8");
const baseSource = readFileSync(new URL("./waterNodeMaterial_base.ts", import.meta.url), "utf8");
const wrapperSource = readFileSync(new URL("./waterNodeMaterial.ts", import.meta.url), "utf8");

describe("water SSR miss routing contract", () => {
  it("uses the exact base-loop hit result and removes the decorator depth trace", () => {
    expect(wrapperSource).toContain("waterNodeMaterial_base.js");
    expect(wrapperSource).not.toContain("decorateWaterSsrMissRouting");
    expect(baseSource).toContain("createWaterSsrMissRoute");
    expect(baseSource).toContain("const missFallback: TslNode = ssrMissRoute.sample(worldPos, rdir)");
    expect(baseSource).toContain("return mix(missFallback, scene, ssrHit.mul(edgeFade))");
    expect(baseSource).not.toContain("const terrainFallback: TslNode = vec3(0.12, 0.14, 0.10)");
    expect(routeSource).not.toContain("viewportDepthTexture");
    expect(routeSource).not.toContain("approximateSsrHit");
    expect(routeSource).toContain("water_ssr_miss_exact_hit_authority");
    expect(routeSource).toContain("water_ssr_miss_duplicate_depth_trace");
  });
});
