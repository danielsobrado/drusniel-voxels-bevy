import { describe, expect, it } from "vitest";
import { requiresDedicatedMovementPage, resolveMovementRouteProfile, sceneForMovementCase } from "./movement_route_profile.js";

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
    expect(profile.minFrameSamples).toBe(1_320);
    expect(profile.maxLiveBubbleEvictions).toBeGreaterThan(0);
    expect(profile.maxStreamEvictions).toBeGreaterThan(0);
  });

  it("defines a deterministic west-to-east continent crossing", () => {
    const profile = resolveMovementRouteProfile("coast-to-coast");
    const displacementX = profile.segments.reduce((sum, segment) => sum + segment.dx, 0);
    const pathDistanceM = profile.segments.reduce((sum, segment) => sum + Math.hypot(segment.dx, segment.dz), 0);

    expect(profile.name).toBe("coast-to-coast");
    expect(profile.start).toEqual([-8_000, 96, 0]);
    expect(displacementX).toBe(16_000);
    expect(pathDistanceM).toBeGreaterThanOrEqual(16_000);
    expect(profile.segments.filter((segment) => segment.phase === "outbound")).toHaveLength(5);
    expect(profile.segments.some((segment) => segment.landmark === "river")).toBe(true);
    expect(profile.segments.some((segment) => segment.landmark === "village-site")).toBe(true);
  });

  it("labels the handed-off RPG village route as representative content", () => {
    const profile = resolveMovementRouteProfile("coast-to-coast", "representative");

    expect(profile.contentProfile).toBe("representative");
    expect(profile.scene).toBe("rpg-village");
    expect(profile.sceneParams).toEqual({
      world: "32",
      startupWorld: "2",
      liveBubble: "1",
      liveBubbleRadius: "200",
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "4",
      liveClodRootMaxCached: "512",
      liveClodRootRadius: "768",
      farClipmapInnerRadius: "768",
      sceneCompileWarm: "1",
      agentEnvelope: "1",
      agentCount: "40",
      agentSkin: "1",
    });
    expect(sceneForMovementCase(profile, true)).toBe("rpg-village");
    expect(sceneForMovementCase(profile, false)).toBe("infinite-islands");
    expect(requiresDedicatedMovementPage(profile, true)).toBe(true);
    expect(requiresDedicatedMovementPage(profile, false)).toBe(false);
    expect(profile.maxRegionDrainFrames).toBe(600);
    expect(profile.maxFrontierLagP95M).toBe(768);
  });

  it("defines a short per-change infrastructure route through cold boundaries", () => {
    const profile = resolveMovementRouteProfile("continent-short");
    const frames = profile.segments.reduce((sum, segment) => sum + segment.frames, 0);
    const distance = profile.segments.reduce((sum, segment) => sum + Math.hypot(segment.dx, segment.dz), 0);

    expect(profile.contentProfile).toBe("infrastructure");
    expect(profile.start).toEqual([-8_000, 96, 0]);
    expect(frames).toBeGreaterThanOrEqual(4_000);
    expect(distance).toBeGreaterThanOrEqual(4_000);
    expect(profile.segments.some((segment) => segment.landmark === "river")).toBe(true);
    expect(profile.maxRegionDrainFrames).toBe(240);
    expect(profile.maxFrontierLagP95M).toBe(384);
  });

  it("adds an eviction-forcing A-to-B-to-A revisit without changing the final pose", () => {
    const crossing = resolveMovementRouteProfile("coast-to-coast");
    const revisit = resolveMovementRouteProfile("coast-to-coast-revisit");
    const revisitSegments = revisit.segments.filter((segment) => segment.phase === "revisit");
    const revisitDistanceM = revisitSegments.reduce((sum, segment) => sum + Math.hypot(segment.dx, segment.dz), 0);

    expect(revisit.name).toBe("coast-to-coast-revisit");
    expect(revisit.segments.length).toBe(crossing.segments.length + 2);
    expect(revisitDistanceM).toBeGreaterThanOrEqual(6_000);
    expect(revisitSegments.reduce((sum, segment) => sum + segment.dx, 0)).toBe(0);
    expect(revisitSegments.reduce((sum, segment) => sum + segment.dz, 0)).toBe(0);
  });
});
