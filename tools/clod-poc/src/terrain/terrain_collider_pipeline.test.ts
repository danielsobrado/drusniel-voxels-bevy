// Async revision-validated collider replacement (playable-world-contract P2.1/P2.2):
// no MeshBVH construction on the calling (frame) path, old collider serves until the
// validated replacement installs atomically, stale results are discarded per revision.
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { TerrainColliderSet } from "./terrain_collider.js";
import { GameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import { DEFAULT_PLAYER_CONFIG } from "../player_controller.js";

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

const FOOTPRINT = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };

function groundHeight(colliders: TerrainColliderSet): number | null {
  const hit = colliders.raycastSpawn(new THREE.Ray(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0)));
  return hit ? hit.point.y : null;
}

describe("collider rebuild pipeline", () => {
  let diagnostics: GameplayDiagnostics;
  let colliders: TerrainColliderSet;

  beforeEach(() => {
    diagnostics = new GameplayDiagnostics();
    colliders = new TerrainColliderSet(
      [{ id: "page", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics },
    );
    colliders.prewarmAll();
  });

  it("schedulePageUpdate builds NO BVH on the calling path; the old collider keeps serving", () => {
    const buildsBefore = diagnostics.get("collider_build_count");
    expect(colliders.schedulePageUpdate("page", plane(20, 5), 1)).toBe(true);
    expect(diagnostics.get("collider_build_count")).toBe(buildsBefore); // zero builds on this path
    expect(diagnostics.get("collider_jobs_queued")).toBe(1);
    expect(diagnostics.get("collider_jobs_inflight")).toBe(1);
    expect(colliders.pendingRebuildCount()).toBe(1);
    expect(groundHeight(colliders)).toBeCloseTo(0, 5); // old geometry still answers
  });

  it("processPendingRebuilds installs the replacement atomically and disposes the old page", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    expect(colliders.processPendingRebuilds()).toBe(1);
    expect(colliders.pendingRebuildCount()).toBe(0);
    expect(groundHeight(colliders)).toBeCloseTo(5, 5);
    expect(diagnostics.get("collider_jobs_completed")).toBe(1);
    expect(diagnostics.get("collider_jobs_inflight")).toBe(0);
    expect(diagnostics.get("collider_queue_latency_ms")).toBeGreaterThanOrEqual(0);
    expect(colliders.colliderStatusAt(0, 0)).toEqual({ covered: true, revision: 1, replacementPending: false });
    // The pipeline build is off-frame by contract: no sync-frame build was recorded.
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);
  });

  it("re-queueing before processing supersedes the older job (cancelled_stale) and installs only the newest revision", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    colliders.schedulePageUpdate("page", plane(20, 9), 2);
    expect(diagnostics.get("collider_jobs_cancelled_stale")).toBe(1);
    expect(colliders.pendingRebuildCount()).toBe(1);
    expect(colliders.processPendingRebuilds(8)).toBe(1);
    expect(groundHeight(colliders)).toBeCloseTo(9, 5);
    expect(colliders.colliderStatusAt(0, 0).revision).toBe(2);
  });

  it("a queued job for a removed page is discarded, not installed", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    colliders.removePage("page");
    expect(colliders.pendingRebuildCount()).toBe(0);
    expect(colliders.processPendingRebuilds(8)).toBe(0);
    expect(groundHeight(colliders)).toBeNull();
  });

  it("a sync updatePage after scheduling cancels the queued job so stale geometry cannot resurrect", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    colliders.updatePage("page", plane(20, 7), 2);
    expect(diagnostics.get("collider_jobs_cancelled_stale")).toBe(1);
    expect(colliders.processPendingRebuilds(8)).toBe(0);
    expect(groundHeight(colliders)).toBeCloseTo(7, 5);
  });

  it("stale-collider policy: capsule resolves against the old page count collider_stale_frames while a rebuild is pending", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    const result = colliders.resolveCapsule(
      new THREE.Vector3(0, -0.1, 0),
      new THREE.Vector3(0, -1, 0),
      DEFAULT_PLAYER_CONFIG,
    );
    expect(result.grounded).toBe(true); // standing on the explicitly stale collider is allowed
    expect(diagnostics.get("collider_stale_frames")).toBe(1);
    expect(colliders.colliderStatusAt(0, 0).replacementPending).toBe(true);
    colliders.processPendingRebuilds();
    colliders.resolveCapsule(new THREE.Vector3(0, 4.9, 0), new THREE.Vector3(0, -1, 0), DEFAULT_PLAYER_CONFIG);
    expect(diagnostics.get("collider_stale_frames")).toBe(1); // no longer stale after install
  });

  it("floating-origin translation moves pending job snapshots with the live entries", () => {
    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    colliders.translateHorizontal(100, 0);
    colliders.processPendingRebuilds();
    const hit = colliders.raycastSpawn(new THREE.Ray(new THREE.Vector3(100, 50, 0), new THREE.Vector3(0, -1, 0)));
    expect(hit?.point.y).toBeCloseTo(5, 5);
    expect(colliders.coversPoint(100, 0)).toBe(true);
    expect(colliders.coversPoint(0, 0)).toBe(false);
  });

  it("lazy first-touch builds outside the pipeline are visible as sync frame builds", () => {
    const coldDiagnostics = new GameplayDiagnostics();
    const cold = new TerrainColliderSet(
      [{ id: "cold", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics: coldDiagnostics },
    );
    // No prewarm: the first query pays the build on the calling path — counted.
    cold.resolveCapsule(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, -1, 0), DEFAULT_PLAYER_CONFIG);
    expect(coldDiagnostics.get("collider_sync_frame_builds")).toBe(1);
    expect(coldDiagnostics.get("collider_build_total_ms")).toBeGreaterThan(0);
    cold.dispose();
  });
});
