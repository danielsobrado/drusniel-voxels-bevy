import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  pageInsideFiniteStartupWorld,
  streamingClodPageKey,
  streamingClodRequiredPageCoords,
} from "./clod_streaming_roots.js";

describe("streamingClodRequiredPageCoords", () => {
  it("returns deterministic page coords around positive and negative centers", () => {
    const positive = streamingClodRequiredPageCoords(new THREE.Vector3(1500, 0, 300), 96, 64)
      .map((coord) => streamingClodPageKey(coord.px, coord.pz));
    const negative = streamingClodRequiredPageCoords(new THREE.Vector3(-150, 0, -300), 96, 64)
      .map((coord) => streamingClodPageKey(coord.px, coord.pz));

    expect(positive).toContain("L0:23,4");
    expect(negative).toContain("L0:-3,-5");
  });

  it("sorts closest pages first", () => {
    const coords = streamingClodRequiredPageCoords(new THREE.Vector3(128, 0, 128), 160, 64);
    const distances = coords.map((coord) => Math.hypot(128 - coord.centerX, 128 - coord.centerZ));

    expect(distances[0]).toBeLessThanOrEqual(distances.at(-1) ?? Number.POSITIVE_INFINITY);
  });
});

describe("pageInsideFiniteStartupWorld", () => {
  it("accepts only startup-world pages", () => {
    expect(pageInsideFiniteStartupWorld(0, 0, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(15, 15, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(16, 15, 16, 16)).toBe(false);
    expect(pageInsideFiniteStartupWorld(-1, 0, 16, 16)).toBe(false);
  });
});
