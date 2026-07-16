// Temporary debug instrumentation for the baseline harness — delete before commit.
import { describe, it } from "vitest";
import * as THREE from "three";
import { PlayerController } from "../../src/player_controller.js";
import { TerrainColliderSet } from "../../src/terrain/terrain_collider.js";
import { gameplayDiagnostics, resetGameplayDiagnosticsForTests } from "../../src/player/gameplay_diagnostics.js";
import { appColumnCertified, createAppCellReadinessFeeds, movementReadinessAt } from "../../src/player/cell_readiness.js";
import { setVoxelOverlayResidentBounds } from "../../src/terrain/voxel_overlay/voxel_overlay.js";
import { baseSurfaceHeight, CAVE, UNSTREAMED } from "./playable_baseline.js";

describe("debug", () => {
  it("traces sync builds and unstreamed entry", () => {
    resetGameplayDiagnosticsForTests();
    setVoxelOverlayResidentBounds("baseline-cave", CAVE);
    setVoxelOverlayResidentBounds("baseline-unstreamed", UNSTREAMED);

    // Minimal repro: ground plane pages around the unstreamed corner, sprint at it.
    const pages = [] as { id: string; geometry: THREE.BufferGeometry; footprint: { minX: number; minZ: number; maxX: number; maxZ: number } }[];
    for (let px = 7; px <= 9; px++) {
      for (let pz = 7; pz <= 9; pz++) {
        if (px === 9 && pz === 9) continue;
        const g = new THREE.PlaneGeometry(64, 64, 1, 1);
        g.rotateX(-Math.PI / 2);
        g.translate(px * 64 + 32, 40, pz * 64 + 32);
        pages.push({ id: `p${px},${pz}`, geometry: g, footprint: { minX: px * 64, minZ: pz * 64, maxX: px * 64 + 64, maxZ: pz * 64 + 64 } });
      }
    }
    const colliders = new TerrainColliderSet(pages, {
      enabled: true,
      surfaceHeight: () => 40,
      certifyColumn: appColumnCertified,
    });
    colliders.prewarmAll();
    const controller = new PlayerController(colliders, { minX: 0, minZ: 0, maxX: 640, maxZ: 640 });
    const feeds = createAppCellReadinessFeeds({ terrainColliders: colliders });
    controller.attachMovementReadiness((x, z) => movementReadinessAt(feeds, x, z));
    controller.spawn(new THREE.Vector3(552, 40.5, 608));
    const target = { x: 608, z: 608 };
    let entered = -1;
    for (let frame = 0; frame < 1200; frame++) {
      const d = Math.atan2(target.x - controller.position.x, -(target.z - controller.position.z));
      const forward = new THREE.Vector3(Math.sin(d), 0, -Math.cos(d));
      controller.update(1 / 60, { forward: 1, right: 0, sprint: true, jump: false }, forward);
      const { x, z } = controller.position;
      if (entered < 0 && x >= UNSTREAMED.minX && z >= UNSTREAMED.minZ) entered = frame;
      if (frame % 200 === 0) {
        console.log(`frame=${frame} pos=(${x.toFixed(1)},${controller.position.y.toFixed(1)},${z.toFixed(1)}) grounded=${controller.grounded} barrier=${gameplayDiagnostics.get("frontier_barrier_engagements")} sync=${gameplayDiagnostics.get("collider_sync_frame_builds")} covMiss=${gameplayDiagnostics.get("collider_coverage_missing")}`);
      }
    }
    console.log(`enteredAtFrame=${entered} final=(${controller.position.x.toFixed(1)},${controller.position.z.toFixed(1)}) barrier=${gameplayDiagnostics.get("frontier_barrier_engagements")} sync=${gameplayDiagnostics.get("collider_sync_frame_builds")}`);
    setVoxelOverlayResidentBounds("baseline-cave", null);
    setVoxelOverlayResidentBounds("baseline-unstreamed", null);
    resetGameplayDiagnosticsForTests();
  });
});
