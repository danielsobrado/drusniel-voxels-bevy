import { describe, expect, it } from "vitest";
import { resolveMovementRouteProfile } from "./movement_route_profile.js";

describe("infinite-islands movement route profiles", () => {
  it("keeps the default walk route compact", () => {
    const profile = resolveMovementRouteProfile(false);
    expect(profile.name).toBe("walk");
    expect(profile.minHorizontalDistanceM).toBe(48);
    expect(profile.segments.reduce((sum, segment) => sum + segment.frames, 0)).toBe(460);
  });

  it("defines a standing multi-kilometre route with bounded eviction limits", () => {
    const profile = resolveMovementRouteProfile(true);
    const pathDistanceM = profile.segments.reduce((sum, segment) => sum + Math.hypot(segment.dx, segment.dz), 0);
    expect(profile.name).toBe("long-route");
    expect(pathDistanceM).toBeGreaterThanOrEqual(3_000);
    expect(profile.minHorizontalDistanceM).toBeGreaterThanOrEqual(3_000);
    expect(profile.minFrameSamples).toBe(1_024);
    expect(profile.maxLiveBubbleEvictions).toBeGreaterThan(0);
    expect(profile.maxStreamEvictions).toBeGreaterThan(0);
  });
});
