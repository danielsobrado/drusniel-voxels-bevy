import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { beforeEach, describe, expect, it } from "vitest";
import { GameplayDiagnostics } from "../player/gameplay_diagnostics.js";
import {
  TerrainColliderSet,
  type TerrainColliderFootprint,
} from "./terrain_collider.js";
import type {
  TerrainColliderBuildInput,
  TerrainColliderBuildResult,
  TerrainColliderRemoteBuilder,
} from "./terrain_collider_worker_client.js";

const FOOTPRINT: TerrainColliderFootprint = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };

function plane(size: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function buildResult(input: TerrainColliderBuildInput): TerrainColliderBuildResult {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(input.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(input.indices, 1));
  const bvh = new MeshBVH(geometry);
  const serialized = MeshBVH.serialize(bvh);
  geometry.dispose();
  return { serialized, buildMs: 0.25 };
}

class ImmediateBuilder implements TerrainColliderRemoteBuilder {
  disposed = false;

  available(): boolean {
    return !this.disposed;
  }

  async build(input: TerrainColliderBuildInput): Promise<TerrainColliderBuildResult> {
    return buildResult(input);
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface DeferredCall {
  input: TerrainColliderBuildInput;
  resolve: (result: TerrainColliderBuildResult) => void;
}

class DeferredBuilder implements TerrainColliderRemoteBuilder {
  readonly calls: DeferredCall[] = [];
  disposed = false;

  available(): boolean {
    return !this.disposed;
  }

  build(input: TerrainColliderBuildInput): Promise<TerrainColliderBuildResult> {
    return new Promise((resolve) => this.calls.push({ input, resolve }));
  }

  resolveNext(): void {
    const call = this.calls.shift();
    if (!call) throw new Error("No deferred collider build is pending");
    call.resolve(buildResult(call.input));
  }

  dispose(): void {
    this.disposed = true;
  }
}

class RejectingBuilder implements TerrainColliderRemoteBuilder {
  available(): boolean {
    return true;
  }

  build(): Promise<TerrainColliderBuildResult> {
    return Promise.reject(new Error("worker unavailable"));
  }

  dispose(): void {}
}

function groundHeight(colliders: TerrainColliderSet, x = 0): number | null {
  const ray = new THREE.Ray(new THREE.Vector3(x, 100, 0), new THREE.Vector3(0, -1, 0));
  return colliders.raycastSpawn(ray)?.point.y ?? null;
}

describe("terrain collider worker pipeline", () => {
  let diagnostics: GameplayDiagnostics;

  beforeEach(() => {
    diagnostics = new GameplayDiagnostics();
  });

  it("builds and atomically installs a replacement through the remote builder", async () => {
    const builder = new ImmediateBuilder();
    const colliders = new TerrainColliderSet(
      [{ id: "page", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics, remoteBuilder: builder },
    );
    colliders.prewarmAll();

    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    expect(groundHeight(colliders)).toBeCloseTo(0, 5);

    expect(await colliders.processPendingRebuildsAsync()).toBe(1);
    expect(groundHeight(colliders)).toBeCloseTo(5, 5);
    expect(diagnostics.get("collider_worker_build_count")).toBe(1);
    expect(diagnostics.get("collider_worker_fallback_builds")).toBe(0);
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);
    expect(colliders.colliderStatusAt(0, 0)).toEqual({ covered: true, revision: 1, replacementPending: false });
    colliders.dispose();
  });

  it("builds a streamed initial page before exposing it to frame-path raycasts", async () => {
    const builder = new DeferredBuilder();
    const colliders = new TerrainColliderSet(
      [],
      null,
      { diagnostics, remoteBuilder: builder, autoProcessRebuilds: true },
    );

    colliders.upsertPage({ id: "streamed", geometry: plane(20, 3), footprint: FOOTPRINT });
    expect(builder.calls).toHaveLength(1);
    expect(colliders.colliderStatusAt(0, 0).covered).toBe(false);
    expect(colliders.pendingRebuildCount()).toBe(1);
    expect(groundHeight(colliders)).toBeNull();
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);

    builder.resolveNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(colliders.colliderStatusAt(0, 0)).toEqual({ covered: true, revision: 0, replacementPending: false });
    expect(colliders.pendingRebuildCount()).toBe(0);
    expect(groundHeight(colliders)).toBeCloseTo(3, 5);
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);
    colliders.dispose();
  });

  it("discards an in-flight stale result and installs the newer revision", async () => {
    const builder = new DeferredBuilder();
    const colliders = new TerrainColliderSet(
      [{ id: "page", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics, remoteBuilder: builder },
    );
    colliders.prewarmAll();

    colliders.schedulePageUpdate("page", plane(20, 5), 1);
    const staleDrain = colliders.processPendingRebuildsAsync();
    expect(builder.calls).toHaveLength(1);
    colliders.schedulePageUpdate("page", plane(20, 9), 2);
    builder.resolveNext();
    await staleDrain;

    expect(groundHeight(colliders)).toBeCloseTo(0, 5);
    expect(diagnostics.get("collider_jobs_cancelled_stale")).toBe(1);
    expect(colliders.colliderStatusAt(0, 0).replacementPending).toBe(true);

    const currentDrain = colliders.processPendingRebuildsAsync();
    expect(builder.calls).toHaveLength(1);
    builder.resolveNext();
    await currentDrain;

    expect(groundHeight(colliders)).toBeCloseTo(9, 5);
    expect(colliders.colliderStatusAt(0, 0).revision).toBe(2);
    colliders.dispose();
  });

  it("falls back without recording a frame-path build when the worker fails", async () => {
    const colliders = new TerrainColliderSet(
      [{ id: "page", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics, remoteBuilder: new RejectingBuilder() },
    );
    colliders.prewarmAll();
    colliders.schedulePageUpdate("page", plane(20, 4), 1);

    await colliders.processPendingRebuildsAsync();

    expect(groundHeight(colliders)).toBeCloseTo(4, 5);
    expect(diagnostics.get("collider_worker_failures")).toBe(1);
    expect(diagnostics.get("collider_worker_fallback_builds")).toBe(1);
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);
    colliders.dispose();
  });

  it("refits loaded BVHs on a floating-origin translation instead of rebuilding them", () => {
    const colliders = new TerrainColliderSet(
      [{ id: "page", geometry: plane(20, 0), footprint: FOOTPRINT }],
      null,
      { diagnostics, remoteBuilder: null },
    );
    colliders.prewarmAll();
    const buildsBefore = diagnostics.get("collider_build_count");

    colliders.translateHorizontal(100, 0);

    expect(groundHeight(colliders, 0)).toBeNull();
    expect(groundHeight(colliders, 100)).toBeCloseTo(0, 5);
    expect(diagnostics.get("collider_build_count")).toBe(buildsBefore);
    expect(diagnostics.get("collider_sync_frame_builds")).toBe(0);
    colliders.dispose();
  });
});
