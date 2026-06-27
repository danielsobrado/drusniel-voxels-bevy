import { afterEach, describe, expect, it } from "vitest";
import { setTerrainSurfaceOverride } from "../terrain/terrain.js";
import { DEFAULT_GRASS_SETTINGS, type GrassSettings } from "./grass_config.js";
import { generateGrassRingInstances } from "./grass_gpu_ring.js";

afterEach(() => setTerrainSurfaceOverride(null));

describe("grass GPU ring CPU mirror", () => {
  it("keeps CPU fallback ring height tiers aligned with GPU tier scaling", () => {
    setTerrainSurfaceOverride(() => 24);
    const settings: GrassSettings = {
      ...DEFAULT_GRASS_SETTINGS,
      shaderMode: "webgpu-ring-v1",
      distance: 220,
      distanceM: 220,
      bladeSpacing: 2.4,
      bladeHeightVariation: 0,
      maxBlades: 30000,
      maxInstances: 30000,
      slopeMinY: 0,
      minHeight: 0,
      maxHeight: 128,
      placement: {
        ...DEFAULT_GRASS_SETTINGS.placement,
        slopeMinY: 0,
        minHeightM: 0,
        maxHeightM: 128,
      },
    };

    const ring = generateGrassRingInstances({ x: 256, z: 256 }, settings, 512);

    expect(ring.near.length).toBeGreaterThan(0);
    expect(ring.super.length).toBeGreaterThan(0);
    expect(ring.near[0]?.height).toBeCloseTo(settings.bladeHeight, 6);
    expect(ring.super[0]?.height).toBeCloseTo(settings.bladeHeight * 2.25, 6);
    expect(ring.near[0]?.offset[1]).toBeCloseTo(24.02, 6);
  });
});
