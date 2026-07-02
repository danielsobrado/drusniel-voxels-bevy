import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { ClodApplyQueue, DEFAULT_CLOD_APPLY_BUDGET, type ClodApplyBudget } from "./clod_apply_queue.js";

function mesh(triangles = 1): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array(3),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
    indices: new Uint32Array(Array.from({ length: triangles * 3 }, (_, i) => i % 3)),
  };
}

function node(id: string, level = 0, x = 0): ClodPageNode {
  return {
    id,
    revision: 1,
    level,
    children: [],
    mesh: mesh(2),
    footprint: { minX: x, minZ: 0, maxX: x + 1, maxZ: 1 },
    bounds: { center: [x, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function budget(overrides: Partial<ClodApplyBudget> = {}): ClodApplyBudget {
  return { ...DEFAULT_CLOD_APPLY_BUDGET, ...overrides };
}

describe("ClodApplyQueue", () => {
  it("drains geometry and collider work within per-frame job caps", () => {
    let frame = 1;
    const geometryApplied: string[] = [];
    const colliderApplied: string[] = [];
    const queue = new ClodApplyQueue({
      budget: budget({ maxGeometryJobsPerFrame: 1, maxColliderJobsPerFrame: 1, maxApplyMsPerFrame: 100 }),
      applyGeometry: (n) => {
        geometryApplied.push(n.id);
        return { geometryMs: 0.2, materialMs: 0, triangles: 2, reusedGeometry: false };
      },
      applyCollider: (n) => {
        colliderApplied.push(n.id);
        return 0.1;
      },
      getFrameId: () => frame,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => false,
    });

    queue.enqueueNodes([node("L0:0,0"), node("L0:1,0")]);
    let stats = queue.drain();
    expect(geometryApplied).toEqual(["L0:0,0"]);
    expect(colliderApplied).toEqual(["L0:0,0"]);
    expect(stats.clodApplyNodes).toBe(1);
    expect(stats.clodApplyQueueDepth).toBe(1);
    expect(stats.clodColliderQueueDepth).toBe(0);

    frame++;
    stats = queue.drain();
    expect(geometryApplied).toEqual(["L0:0,0", "L0:1,0"]);
    expect(colliderApplied).toEqual(["L0:0,0", "L0:1,0"]);
    expect(stats.clodApplyQueueDepth).toBe(0);
  });

  it("reports stale visible geometry while pending replacement waits", () => {
    const queue = new ClodApplyQueue({
      budget: budget({ maxGeometryJobsPerFrame: 1, maxColliderJobsPerFrame: 0, maxApplyMsPerFrame: 100 }),
      applyGeometry: () => ({ geometryMs: 0, materialMs: 0, triangles: 2, reusedGeometry: true }),
      applyCollider: () => 0,
      getFrameId: () => 1,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => true,
    });

    queue.enqueueNodes([node("L0:0,0"), node("L0:1,0")]);
    const stats = queue.drain();
    expect(stats.clodStaleVisibleNodes).toBe(1);
    expect(stats.clodGeometryReusedOnApply).toBe(1);
  });

  it("runs one stale collider priority override even when normal collider budget is exhausted", () => {
    let frame = 1;
    const colliderApplied: string[] = [];
    const queue = new ClodApplyQueue({
      budget: budget({ maxApplyMsPerFrame: 0, maxGeometryJobsPerFrame: 1, maxColliderJobsPerFrame: 0, colliderMaxDelayFrames: 2 }),
      applyGeometry: () => ({ geometryMs: 0, materialMs: 0, triangles: 2, reusedGeometry: false }),
      applyCollider: (n) => {
        colliderApplied.push(n.id);
        return 0;
      },
      getFrameId: () => frame,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => false,
    });

    queue.enqueueNodes([node("L0:0,0")]);
    frame = 4;
    const stats = queue.drain();

    expect(colliderApplied).toEqual(["L0:0,0"]);
    expect(stats.clodColliderJobsApplied).toBe(1);
    expect(stats.clodColliderPriorityOverrides).toBe(1);
    expect(stats.clodColliderStaleFramesMax).toBe(3);
    expect(stats.clodColliderQueueDepth).toBe(0);
  });

  it("keeps a fresh collider queued when normal collider budget is exhausted", () => {
    const colliderApplied: string[] = [];
    const queue = new ClodApplyQueue({
      budget: budget({ maxApplyMsPerFrame: 100, maxGeometryJobsPerFrame: 1, maxColliderJobsPerFrame: 0, colliderMaxDelayFrames: 2 }),
      applyGeometry: () => ({ geometryMs: 0, materialMs: 0, triangles: 2, reusedGeometry: false }),
      applyCollider: (n) => {
        colliderApplied.push(n.id);
        return 0;
      },
      getFrameId: () => 1,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => false,
    });

    queue.enqueueNodes([node("L0:0,0")]);
    const stats = queue.drain();

    expect(colliderApplied).toEqual([]);
    expect(stats.clodColliderQueueDepth).toBe(1);
  });

  it("does not count acknowledged but unapplied geometry as an applied node", () => {
    const queue = new ClodApplyQueue({
      budget: budget({ maxGeometryJobsPerFrame: 1 }),
      applyGeometry: () => ({ applied: false, geometryMs: 0, materialMs: 0, triangles: 2, reusedGeometry: false }),
      applyCollider: () => 0,
      getFrameId: () => 1,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => false,
    });

    queue.enqueueNodes([node("L1:0,0", 1)]);
    const stats = queue.drain();

    expect(stats.clodApplyNodes).toBe(0);
    expect(stats.clodApplyTriangles).toBe(0);
    expect(stats.clodApplyQueueDepth).toBe(0);
  });

  it("reports apply failures without breaking later jobs", () => {
    const failures: string[] = [];
    const geometryApplied: string[] = [];
    const queue = new ClodApplyQueue({
      budget: budget({ maxGeometryJobsPerFrame: 2, maxColliderJobsPerFrame: 0, maxApplyMsPerFrame: 100 }),
      applyGeometry: (n) => {
        if (n.id === "bad") throw new Error("bad geometry");
        geometryApplied.push(n.id);
        return { geometryMs: 0.1, materialMs: 0, triangles: 2, reusedGeometry: false };
      },
      applyCollider: () => 0,
      getFrameId: () => 1,
      getCameraPosition: () => ({ x: 0, z: 0 }),
      isNodeVisible: () => false,
      onApplyFailed: (kind, n, error) => {
        failures.push(`${kind}:${n.id}:${error instanceof Error ? error.message : String(error)}`);
      },
    });

    queue.enqueueNodes([node("bad"), node("good")]);
    const stats = queue.drain();

    expect(failures).toEqual(["geometry:bad:bad geometry"]);
    expect(geometryApplied).toEqual(["good"]);
    expect(stats.clodApplyNodes).toBe(1);
    expect(stats.clodApplyQueueDepth).toBe(0);
  });
});
