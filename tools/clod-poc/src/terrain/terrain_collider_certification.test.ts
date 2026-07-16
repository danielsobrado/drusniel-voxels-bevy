// Height-fallback restriction (playable-world-contract P2.4): the fallback consults
// column certification and never fires in voxel-overlay/edited/overhang columns.
// The cave case failed against the pre-P2 code — the proof the restriction bites.
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { TerrainColliderSet } from "./terrain_collider.js";
import { GameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import { DEFAULT_PLAYER_CONFIG } from "../player_controller.js";

describe("height fallback column certification", () => {
  let diagnostics: GameplayDiagnostics;

  beforeEach(() => {
    diagnostics = new GameplayDiagnostics();
  });

  it("an airborne player inside a cave (uncertified column) is NOT snapped to the surface above", () => {
    // Canonical surface at y = 42; the player is in a cave void at y = 20 below it.
    const caveColumn = (x: number) => x > 100; // cave region east of x = 100
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 42,
      certifyColumn: (x) => !caveColumn(x),
    }, { diagnostics });

    const inCave = colliders.resolveCapsule(
      new THREE.Vector3(150, 20, 0),
      new THREE.Vector3(0, -5, 0),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(inCave.position.y).toBe(20); // no invented floor
    expect(inCave.velocity.y).toBe(-5); // keeps falling until a real collider catches it
    expect(inCave.grounded).toBe(false);
    expect(diagnostics.get("fallback_denied_uncertified")).toBe(1);
    expect(diagnostics.get("fallback_heightfield_certified")).toBe(0);
  });

  it("the same sink in a certified single-surface column still gets the fallback snap", () => {
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 42,
      certifyColumn: () => true,
    }, { diagnostics });

    const onSurface = colliders.resolveCapsule(
      new THREE.Vector3(50, 41.5, 0),
      new THREE.Vector3(0, -5, 0),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(onSurface.position.y).toBe(42);
    expect(onSurface.grounded).toBe(true);
    expect(diagnostics.get("fallback_heightfield_certified")).toBe(1);
  });

  it("absent certifier keeps legacy heightfield-only behavior (certified everywhere)", () => {
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 10,
    }, { diagnostics });
    const result = colliders.resolveCapsule(
      new THREE.Vector3(0, 9, 0),
      new THREE.Vector3(0, -1, 0),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(result.grounded).toBe(true);
    expect(result.position.y).toBe(10);
  });

  it("reason codes split benign airborne from genuine coverage loss", () => {
    const colliders = new TerrainColliderSet([], {
      enabled: true,
      surfaceHeight: () => 42,
      certifyColumn: (x) => x <= 100,
    }, { diagnostics });

    // Airborne ABOVE a certified fallback column: benign (the certified floor exists below).
    colliders.resolveCapsule(new THREE.Vector3(50, 60, 0), new THREE.Vector3(0, -1, 0), DEFAULT_PLAYER_CONFIG);
    expect(diagnostics.get("collider_exact_no_ground")).toBe(1);
    expect(diagnostics.get("collider_coverage_missing")).toBe(0);

    // Airborne in an uncertified column with no collider anywhere: genuine coverage loss.
    colliders.resolveCapsule(new THREE.Vector3(150, 60, 0), new THREE.Vector3(0, -1, 0), DEFAULT_PLAYER_CONFIG);
    expect(diagnostics.get("collider_coverage_missing")).toBe(1);
  });
});
