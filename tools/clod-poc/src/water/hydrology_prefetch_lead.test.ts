import { describe, expect, it } from "vitest";
import { HYDROLOGY_PREFETCH_LEAD_SECONDS, leadHydrologyPrefetchCenter } from "./hydrology_prefetch_lead.js";

describe("leadHydrologyPrefetchCenter", () => {
  it("does not lead a stationary (or purely rotating) camera", () => {
    expect(leadHydrologyPrefetchCenter(5, 7, 5, 7, 1 / 60, 100)).toEqual({ x: 5, z: 7 });
  });

  it("does not lead when the prefetch radius is zero", () => {
    expect(leadHydrologyPrefetchCenter(5, 7, 0, 0, 1, 0)).toEqual({ x: 5, z: 7 });
  });

  it("leads ahead in the direction of travel by speed x lead-seconds", () => {
    // Moved +1m x in 1s -> 1 m/s; lead = 1 * 2s = 2m, well under the 50m cap.
    const center = leadHydrologyPrefetchCenter(1, 0, 0, 0, 1, 100, 2);
    expect(center.x).toBeCloseTo(3, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });

  it("caps the lead at half the prefetch radius so the current cell stays covered", () => {
    // 100 m/s would lead 200m; capped to radius/2 = 50m.
    const center = leadHydrologyPrefetchCenter(100, 0, 0, 0, 1, 100, 2);
    expect(center.x).toBeCloseTo(150, 6);
    expect(Math.hypot(center.x - 100, center.z)).toBeCloseTo(50, 6);
  });

  it("leads along a diagonal heading", () => {
    // Heading (3,4)/5, speed 5, lead = min(10, 50) = 10.
    const center = leadHydrologyPrefetchCenter(3, 4, 0, 0, 1, 100, 2);
    expect(center.x).toBeCloseTo(9, 6);
    expect(center.z).toBeCloseTo(12, 6);
  });

  it("keeps the lead within half the radius at any speed (current-cell coverage invariant)", () => {
    for (const speed of [0.1, 1, 10, 1000]) {
      const center = leadHydrologyPrefetchCenter(speed, 0, 0, 0, 1, 40);
      expect(Math.hypot(center.x - speed, center.z)).toBeLessThanOrEqual(40 * 0.5 + 1e-9);
    }
  });

  it("exposes a positive default lead horizon", () => {
    expect(HYDROLOGY_PREFETCH_LEAD_SECONDS).toBeGreaterThan(0);
  });
});
