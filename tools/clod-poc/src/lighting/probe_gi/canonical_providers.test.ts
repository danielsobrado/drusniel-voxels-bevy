import { describe, expect, it } from "vitest";
import type { ComposedEnvironmentQuery } from "../../environment_query/runtime.js";
import { createCanonicalProbeGiProviders } from "./canonical_providers.js";

describe("canonical probe GI providers", () => {
  it("reuses terrain heights across vertical relocation samples", () => {
    let samples = 0;
    const providers = createCanonicalProbeGiProviders({
      surfaceHeightBestEffort() {
        samples++;
        return { height: 12, meta: { source: "live-terrain", valid: true, revision: 0, cellSizeM: 1 } };
      },
    } as unknown as ComposedEnvironmentQuery);

    expect(providers.solid.densityAt(4, 8, 6, 4)).toBe(4);
    expect(providers.solid.densityAt(4, 9, 6, 4)).toBe(3);
    expect(providers.terrain.heightAt(4, 6, 4)).toBe(12);
    expect(samples).toBe(1);
  });
});
