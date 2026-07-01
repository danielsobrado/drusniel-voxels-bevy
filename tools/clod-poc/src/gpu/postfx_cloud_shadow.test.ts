import { describe, expect, it } from "vitest";
import { cloudShadowValue, createPostFxCloudShadowTexture } from "./postfx_cloud_shadow.js";

describe("postfx cloud shadow", () => {
  it("creates a finite repeatable cloud shadow map", () => {
    const a = cloudShadowValue(0.25, 0.75, 4);
    const b = cloudShadowValue(0.25, 0.75, 4);
    expect(a).toBeCloseTo(b, 8);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  it("creates a red float texture at the requested resolution", () => {
    const map = createPostFxCloudShadowTexture({ resolution: 32, worldSizeMeters: 512, strength: 0.7 });
    expect(map.texture.image.width).toBe(32);
    expect(map.texture.image.height).toBe(32);
    expect(map.worldSizeMeters).toBe(512);
    expect(map.strength).toBeCloseTo(0.7);
    const data = map.texture.image.data as Float32Array;
    expect(data.length).toBe(32 * 32);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...data)).toBeLessThanOrEqual(1);
    map.texture.dispose();
  });
});
