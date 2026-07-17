// Readiness contract tests (playable-world-contract P1/P5): answers are per capability
// and per revision — a stale collider is stale-safe for movement and NOT edit-ready.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  cellReadinessAt,
  movementReadinessAt,
  teleportTargetReady,
  type CellReadinessFeeds,
} from "./cell_readiness.js";
import { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { GameplayDiagnostics } from "./gameplay_diagnostics.js";

function feeds(overrides: Partial<CellReadinessFeeds>): CellReadinessFeeds {
  return {
    terrainRevision: () => 0,
    colliderStatusAt: () => ({ covered: false, revision: -1, replacementPending: false }),
    columnCertified: () => false,
    editAuthorityResidentAt: () => true,
    waterQueryReadyAt: () => true,
    ...overrides,
  };
}

describe("cell readiness contract", () => {
  it("exact current collider: movement + water + edit ready, nothing stale", () => {
    const readiness = cellReadinessAt(feeds({
      terrainRevision: () => 3,
      colliderStatusAt: () => ({ covered: true, revision: 3, replacementPending: false }),
    }), 0, 0);
    expect(readiness).toEqual({
      movementCollisionReady: true,
      waterQueryReady: true,
      terrainEditReady: true,
      terrainRevision: 3,
      colliderRevision: 3,
      staleColliderSafe: false,
      fallbackKind: "none",
    });
  });

  it("stale collider (rebuild pending): stale-safe for movement, NOT edit-ready", () => {
    const readiness = cellReadinessAt(feeds({
      terrainRevision: () => 5,
      colliderStatusAt: () => ({ covered: true, revision: 3, replacementPending: true }),
    }), 0, 0);
    expect(readiness.movementCollisionReady).toBe(true);
    expect(readiness.staleColliderSafe).toBe(true);
    expect(readiness.terrainEditReady).toBe(false);
    expect(readiness.colliderRevision).toBe(3);
    expect(readiness.terrainRevision).toBe(5);
  });

  it("no collider, certified column: movement allowed via certified heightfield fallback", () => {
    const readiness = cellReadinessAt(feeds({ columnCertified: () => true }), 0, 0);
    expect(readiness.movementCollisionReady).toBe(true);
    expect(readiness.fallbackKind).toBe("heightfield_certified");
    expect(readiness.terrainEditReady).toBe(false);
  });

  it("no collider, uncertified (cave/edited/unknown): frontier barrier, nothing ready", () => {
    const readiness = cellReadinessAt(feeds({}), 0, 0);
    expect(readiness.movementCollisionReady).toBe(false);
    expect(readiness.fallbackKind).toBe("frontier_barrier");
    expect(readiness.terrainEditReady).toBe(false);
  });

  it("edit authority not resident denies edit readiness even with an exact collider", () => {
    const readiness = cellReadinessAt(feeds({
      colliderStatusAt: () => ({ covered: true, revision: 0, replacementPending: false }),
      editAuthorityResidentAt: () => false,
    }), 0, 0);
    expect(readiness.terrainEditReady).toBe(false);
    expect(readiness.movementCollisionReady).toBe(true);
  });

  it("unknown water blocks movement readiness without pretending collision is missing", () => {
    const input = feeds({
      colliderStatusAt: () => ({ covered: true, revision: 0, replacementPending: false }),
      waterQueryReadyAt: () => false,
    });
    const readiness = cellReadinessAt(input, 0, 0);
    expect(readiness.movementCollisionReady).toBe(true);
    expect(readiness.waterQueryReady).toBe(false);
    expect(movementReadinessAt(input, 0, 0)).toBe("blocked");
    expect(teleportTargetReady(input, 0, 0)).toBe(false);
  });

  it("maps to movement readiness probe values", () => {
    expect(movementReadinessAt(feeds({
      colliderStatusAt: () => ({ covered: true, revision: 0, replacementPending: false }),
    }), 0, 0)).toBe("ready");
    expect(movementReadinessAt(feeds({ columnCertified: () => true }), 0, 0)).toBe("certified");
    expect(movementReadinessAt(feeds({}), 0, 0)).toBe("blocked");
  });

  it("teleport target readiness requires a collision-ready movement envelope", () => {
    expect(teleportTargetReady(feeds({}), 0, 0)).toBe(false);
    expect(teleportTargetReady(feeds({ columnCertified: () => true }), 0, 0)).toBe(true);
    expect(teleportTargetReady(feeds({
      colliderStatusAt: () => ({ covered: true, revision: 0, replacementPending: true }),
    }), 0, 0)).toBe(true);
  });

  it("does not declare a page-edge target ready when the capsule footprint crosses missing coverage", () => {
    const narrowCoverage = feeds({
      colliderStatusAt: (x, z) => ({
        covered: Math.abs(x) < 0.4 && Math.abs(z) < 0.4,
        revision: 0,
        replacementPending: false,
      }),
    });

    expect(cellReadinessAt(narrowCoverage, 0, 0).movementCollisionReady).toBe(true);
    expect(teleportTargetReady(narrowCoverage, 0, 0)).toBe(false);
    expect(teleportTargetReady(narrowCoverage, 0, 0, 0.2)).toBe(true);
  });

  it("requires authoritative target residency even when collision coverage exists", () => {
    expect(teleportTargetReady(feeds({
      colliderStatusAt: () => ({ covered: true, revision: 0, replacementPending: false }),
      editAuthorityResidentAt: () => false,
    }), 0, 0)).toBe(false);
  });

  it("integrates with a real collider set: coverage and pipeline staleness flow through", () => {
    const diagnostics = new GameplayDiagnostics();
    const geometry = new THREE.PlaneGeometry(20, 20, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const colliders = new TerrainColliderSet(
      [{ id: "page", geometry, footprint: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 } }],
      null,
      { diagnostics },
    );
    colliders.prewarmAll();
    const realFeeds = feeds({
      terrainRevision: () => 1,
      colliderStatusAt: (x, z) => colliders.colliderStatusAt(x, z),
    });

    expect(cellReadinessAt(realFeeds, 0, 0).terrainEditReady).toBe(true);
    expect(cellReadinessAt(realFeeds, 500, 500).movementCollisionReady).toBe(false);

    const replacement = new THREE.PlaneGeometry(20, 20, 1, 1);
    replacement.rotateX(-Math.PI / 2);
    colliders.schedulePageUpdate("page", replacement, 1);
    expect(cellReadinessAt(realFeeds, 0, 0).staleColliderSafe).toBe(true);
    expect(cellReadinessAt(realFeeds, 0, 0).terrainEditReady).toBe(false);
    colliders.processPendingRebuilds();
    expect(cellReadinessAt(realFeeds, 0, 0).terrainEditReady).toBe(true);
    expect(cellReadinessAt(realFeeds, 0, 0).colliderRevision).toBe(1);
    colliders.dispose();
  });
});
