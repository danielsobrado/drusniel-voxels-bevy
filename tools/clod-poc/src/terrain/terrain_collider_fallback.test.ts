import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TerrainColliderSet } from "./terrain_collider.js";
import { DEFAULT_PLAYER_CONFIG } from "../player_controller.js";

describe("TerrainColliderSet height fallback", () => {
  it("keeps the player grounded when no streamed page collider is ready", () => {
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 42,
    });

    const result = colliders.resolveCapsule(
      new THREE.Vector3(2048, 41.5, 2048),
      new THREE.Vector3(0, -10, 0),
      DEFAULT_PLAYER_CONFIG,
    );

    expect(result.pagesTested).toBe(0);
    expect(result.position.y).toBe(42);
    expect(result.velocity.y).toBe(0);
    expect(result.grounded).toBe(true);
  });

  it("does not alter movement while above the fallback terrain", () => {
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 42,
    });

    const result = colliders.resolveCapsule(
      new THREE.Vector3(2048, 43, 2048),
      new THREE.Vector3(0, -10, 0),
      DEFAULT_PLAYER_CONFIG,
    );

    expect(result.position.y).toBe(43);
    expect(result.velocity.y).toBe(-10);
    expect(result.grounded).toBe(false);
  });

  it("grounds the capsule on the carved side of a bank", () => {
    const carvedBankHeight = (x: number) => x < 128 ? 42 : 35;
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: (x) => carvedBankHeight(x),
    });

    const result = colliders.resolveCapsule(
      new THREE.Vector3(129, 34.5, 64),
      new THREE.Vector3(0, -8, 0),
      DEFAULT_PLAYER_CONFIG,
    );

    expect(result.position.y).toBe(35);
    expect(result.velocity.y).toBe(0);
    expect(result.grounded).toBe(true);
  });
});
