import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./water_ssr_miss_route.ts", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("./waterNodeMaterial.ts", import.meta.url), "utf8");

describe("water SSR miss routing contract", () => {
  it("routes misses through a directional horizon test and Probe GI", () => {
    expect(wrapper).toContain("decorateWaterSsrMissRouting");
    expect(wrapper).toContain("withoutConstantWaterSsrMissFallback(params.visual)");
    expect(source).toContain("updateSharedHorizonField");
    expect(source).toContain("sampleActiveForestCanopyEcology");
    expect(source).toContain("directionalAtmosphere");
    expect(source).toContain("sampleDirectionalProbeGi");
    expect(source).toContain("uSsrEnabled.greaterThan(0.5)");
    expect(source).not.toContain("mul(uRouteEnabled).mul(uSsrEnabled)");
    expect(source).toContain("cellX.add(0.5)");
    expect(source).toContain("skyFallbackStrength: 0");
    expect(source).toContain("probe_gi_radiance_ready");
    expect(source).not.toContain("probeGiHasRadiance");
    expect(source).toContain("water_ssr_miss_constant_blend\"] = 0");
  });
});
