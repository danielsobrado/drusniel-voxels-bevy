import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TREE_CANOPY_TRANSITION_COUNTERS,
  evaluateTreeCanopyTransitionContract,
  loadTreeCanopyRuntimeContract,
} from "./tree-canopy-transition-acceptance.js";

describe("tree/canopy transition acceptance", () => {
  it("passes the YAML-owned handoff math, material, and budget contract", () => {
    const result = evaluateTreeCanopyTransitionContract();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.budget.maxTriangles).toBeLessThanOrEqual(result.budget.maxShellTris);
  });

  it("loads the same shared runtime range used by bootstrap", () => {
    const runtime = loadTreeCanopyRuntimeContract();
    expect(runtime.settings.lod.canopyFadeStartM).toBe(620);
    expect(runtime.settings.lod.canopyFadeEndM).toBe(760);
    expect(runtime.settings.lod.impostorEndM).toBe(760);
  });

  it("gates the impostor end distance and complementary handoff", () => {
    const result = evaluateTreeCanopyTransitionContract();
    expect(result.handoffStartM).toBe(620);
    expect(result.impostorEndM).toBe(760);
    for (const gate of result.gates) {
      expect(gate.treeVisibility + gate.canopyVisibility).toBeCloseTo(1);
    }
    expect(result.material).toEqual({
      transparent: false,
      depthWrite: true,
      depthTest: true,
      alphaTest: 0,
    });
  });

  it("keeps canopy ownership radial in XZ instead of including camera altitude", () => {
    const source = readFileSync(
      new URL("../src/canopy/canopy_gpu_impostor_material.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("positionWorld.x.sub(cameraPosition.x)");
    expect(source).toContain("positionWorld.z.sub(cameraPosition.z)");
    expect(source).not.toContain("vec3(positionWorld.x, float(0), positionWorld.z).sub(cameraPosition).length()");
  });

  it("documents real runtime signal names", () => {
    expect(TREE_CANOPY_TRANSITION_COUNTERS).toContain("treeStats.impostorTrees");
    expect(TREE_CANOPY_TRANSITION_COUNTERS).toContain("canopy_gpu_impostor_instances");
    expect(TREE_CANOPY_TRANSITION_COUNTERS).toContain("canopy_shell_tris");
    expect(TREE_CANOPY_TRANSITION_COUNTERS).not.toContain("canopy_gpu_impostor_triangles");
  });
});
