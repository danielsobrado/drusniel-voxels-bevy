import { describe, expect, it } from "vitest";
import type { ShadowManifest, ShadowManifestEntry } from "./shadow_manifest.js";
import type { ShadowMeshSet } from "./shadow_mesh.js";
import {
  buildBevyShadowRuntimeSnapshot,
  serializeBevyShadowRuntimeSnapshot,
} from "./bevy_shadow_runtime.js";

function entry(
  nodeId: string,
  policy: ShadowManifestEntry["policy"],
  triangles: number,
  shadowTriangles = triangles,
): ShadowManifestEntry {
  return {
    nodeId,
    level: nodeId.includes("L2") ? 2 : 0,
    childIds: [],
    visualMeshId: `visual:${nodeId}`,
    shadowMeshId: policy === "NoCast" ? null : policy === "VisualMesh" ? `visual:${nodeId}` : `shadow:${nodeId}`,
    policy,
    reason: policy === "NoCast" ? "not-selected" : "proxy",
    distance: policy === "NoCast" ? null : 64,
    errorPx: policy === "NoCast" ? null : 1,
    triangleCount: triangles,
    shadowTriangleBudget: policy === "NoCast" ? 0 : shadowTriangles,
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0, 0, 0], radius: 1 },
  };
}

function manifest(entries: ShadowManifestEntry[]): ShadowManifest {
  return {
    version: 1,
    generatedBy: "clod-poc-shadow-manifest",
    entries,
    totals: {
      totalPages: entries.length,
      casterPages: entries.filter((e) => e.policy !== "NoCast").length,
      visualPages: entries.filter((e) => e.policy === "VisualMesh").length,
      proxyPages: entries.filter((e) => e.policy === "ClodShadowMesh").length,
      noCastPages: entries.filter((e) => e.policy === "NoCast").length,
      visualTriangles: entries.reduce((sum, e) => sum + e.triangleCount, 0),
      shadowTrianglesBudgeted: entries.reduce((sum, e) => sum + e.shadowTriangleBudget, 0),
      maxCasterDistance: 64,
    },
  };
}

function meshSet(): ShadowMeshSet {
  return {
    version: 1,
    generatedBy: "clod-poc-shadow-mesh",
    meshes: [{
      nodeId: "L2:0,0",
      level: 2,
      shadowMeshId: "shadow:L2:0,0",
      visualMeshId: "visual:L2:0,0",
      sourceTriangleCount: 100,
      triangleCount: 25,
      reductionRatio: 0.25,
      footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      mesh: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        sourceTriangleCount: 100,
        triangleCount: 25,
        reductionRatio: 0.25,
      },
    }],
    totals: {
      shadowMeshCount: 1,
      sourceTriangles: 100,
      shadowTriangles: 25,
      savedTriangles: 75,
      savingsRatio: 0.75,
    },
  };
}

describe("buildBevyShadowRuntimeSnapshot", () => {
  it("maps manifest policies to Bevy runtime actions", () => {
    const snapshot = buildBevyShadowRuntimeSnapshot(
      manifest([
        entry("L0:0,0", "VisualMesh", 40),
        entry("L2:0,0", "ClodShadowMesh", 100, 25),
        entry("L2:1,0", "NoCast", 80, 0),
      ]),
      meshSet(),
    );

    expect(snapshot.generatedBy).toBe("clod-poc-bevy-shadow-runtime");
    expect(snapshot.plans.map((plan) => plan.action)).toEqual([
      "UseVisualMeshCaster",
      "SpawnProxyShadowCaster",
      "ApplyNotShadowCaster",
    ]);
    expect(snapshot.proxyMeshes).toHaveLength(1);
    expect(snapshot.totals.visualCasterPages).toBe(1);
    expect(snapshot.totals.proxyCasterPages).toBe(1);
    expect(snapshot.totals.noCastPages).toBe(1);
    expect(snapshot.totals.runtimeShadowTriangles).toBe(65);
    expect(snapshot.totals.savedTriangles).toBe(155);
  });

  it("can emit plan-only snapshots without mesh payloads", () => {
    const snapshot = buildBevyShadowRuntimeSnapshot(
      manifest([entry("L2:0,0", "ClodShadowMesh", 100, 25)]),
      meshSet(),
      { includeMeshPayloads: false },
    );

    expect(snapshot.proxyMeshes).toHaveLength(0);
    expect(snapshot.plans[0].shadowMeshId).toBe("shadow:L2:0,0");
  });

  it("fails fast when a proxy caster has no generated mesh", () => {
    expect(() => buildBevyShadowRuntimeSnapshot(
      manifest([entry("L2:0,0", "ClodShadowMesh", 100, 25)]),
      { ...meshSet(), meshes: [] },
    )).toThrow(/Missing generated proxy mesh/);
  });

  it("counts missing proxy meshes when requireProxyMeshes is false", () => {
    const snapshot = buildBevyShadowRuntimeSnapshot(
      manifest([
        entry("L2:0,0", "ClodShadowMesh", 100, 25),
        entry("L2:1,0", "ClodShadowMesh", 80, 20),
      ]),
      { ...meshSet(), meshes: [] },
      { requireProxyMeshes: false },
    );

    expect(snapshot.plans).toHaveLength(2);
    expect(snapshot.totals.missingProxyMeshes).toBe(2);
    expect(snapshot.proxyMeshes).toHaveLength(0);
  });

  it("serializes typed arrays as JSON arrays", () => {
    const snapshot = buildBevyShadowRuntimeSnapshot(
      manifest([entry("L2:0,0", "ClodShadowMesh", 100, 25)]),
      meshSet(),
    );
    const json = JSON.parse(serializeBevyShadowRuntimeSnapshot(snapshot));

    expect(Array.isArray(json.proxyMeshes[0].positions)).toBe(true);
    expect(Array.isArray(json.proxyMeshes[0].indices)).toBe(true);
  });
});
