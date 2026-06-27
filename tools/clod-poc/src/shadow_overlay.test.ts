import { describe, expect, it } from "vitest";
import type { ShadowManifest, ShadowManifestEntry } from "./shadow_manifest.js";
import {
  buildShadowOverlayModel,
  shadowPolicyColor,
  shadowPolicyShortName,
} from "./shadow_overlay.js";

const baseEntry = (overrides: Partial<ShadowManifestEntry>): ShadowManifestEntry => ({
  nodeId: "L0:0,0",
  level: 0,
  childIds: [],
  visualMeshId: "visual:L0:0,0",
  shadowMeshId: "visual:L0:0,0",
  policy: "VisualMesh",
  reason: "near",
  distance: 0,
  errorPx: 0,
  triangleCount: 100,
  shadowTriangleBudget: 100,
  footprint: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
  bounds: { center: [32, 0, 32], radius: 45 },
  ...overrides,
});

function manifest(): ShadowManifest {
  const entries: ShadowManifestEntry[] = [
    baseEntry({
      nodeId: "L0:0,0",
      level: 0,
      policy: "VisualMesh",
      reason: "near",
      shadowMeshId: "visual:L0:0,0",
      triangleCount: 100,
      shadowTriangleBudget: 100,
      distance: 0,
    }),
    baseEntry({
      nodeId: "L1:0,0",
      level: 1,
      policy: "ClodShadowMesh",
      reason: "proxy",
      visualMeshId: "visual:L1:0,0",
      shadowMeshId: "shadow:L1:0,0",
      triangleCount: 400,
      shadowTriangleBudget: 120,
      distance: 96,
    }),
    baseEntry({
      nodeId: "L2:0,0",
      level: 2,
      policy: "NoCast",
      reason: "not-selected",
      visualMeshId: "visual:L2:0,0",
      shadowMeshId: null,
      triangleCount: 800,
      shadowTriangleBudget: 0,
      distance: null,
    }),
  ];

  return {
    version: 1,
    generatedBy: "clod-poc-shadow-manifest",
    entries,
    totals: {
      totalPages: 3,
      casterPages: 2,
      visualPages: 1,
      proxyPages: 1,
      noCastPages: 1,
      visualTriangles: 1300,
      shadowTrianglesBudgeted: 220,
      maxCasterDistance: 96,
    },
  };
}

describe("shadow overlay policy helpers", () => {
  it("maps stable policy labels and colours", () => {
    expect(shadowPolicyShortName("VisualMesh")).toBe("visual");
    expect(shadowPolicyShortName("ClodShadowMesh")).toBe("proxy");
    expect(shadowPolicyShortName("NoCast")).toBe("none");

    expect(shadowPolicyColor("VisualMesh")).toBe(0xf6b73c);
    expect(shadowPolicyColor("ClodShadowMesh")).toBe(0x42c7ff);
    expect(shadowPolicyColor("NoCast")).toBe(0x6b7280);
  });
});

describe("buildShadowOverlayModel", () => {
  it("filters to active casters by default", () => {
    const model = buildShadowOverlayModel(manifest());

    expect(model.mode).toBe("casters");
    expect(model.entries.map((entry) => entry.nodeId)).toEqual(["L0:0,0", "L1:0,0"]);
    expect(model.entries.every((entry) => entry.policy !== "NoCast")).toBe(true);
  });

  it("can include NoCast pages with dim opacity", () => {
    const model = buildShadowOverlayModel(manifest(), {
      mode: "all",
      noCastOpacity: 0.1,
    });

    expect(model.entries).toHaveLength(3);
    expect(model.entries.find((entry) => entry.policy === "NoCast")?.opacity).toBe(0.1);
  });

  it("hides all entries in off mode while keeping summary totals", () => {
    const model = buildShadowOverlayModel(manifest(), { mode: "off" });

    expect(model.entries).toHaveLength(0);
    expect(model.summary.casterPages).toBe(2);
    expect(model.summary.totalPages).toBe(3);
  });

  it("computes triangle-budget savings against the visual baseline", () => {
    const model = buildShadowOverlayModel(manifest(), { mode: "all" });

    expect(model.summary.visualTriangles).toBe(1300);
    expect(model.summary.shadowTrianglesBudgeted).toBe(220);
    expect(model.summary.savedTriangles).toBe(1080);
    expect(model.summary.savingsRatio).toBeCloseTo(1080 / 1300);
    expect(model.summary.policySummary).toBe("visual:1 proxy:1 none:1");
  });

  it("copies geometry bounds and labels for viewer rendering", () => {
    const model = buildShadowOverlayModel(manifest(), { mode: "all" });
    const proxy = model.entries.find((entry) => entry.policy === "ClodShadowMesh")!;

    expect(proxy.label).toContain("L1:0,0");
    expect(proxy.label).toContain("proxy");
    expect(proxy.label).toContain("96.0m");
    expect(proxy.footprint).toEqual({ minX: 0, minZ: 0, maxX: 64, maxZ: 64 });
    expect(proxy.bounds.center).toEqual([32, 0, 32]);
  });
});
