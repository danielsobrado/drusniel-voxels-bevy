import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  evaluateTreeImpostorOrbitWidthGate,
  treeImpostorCylindricalBillboardBasis,
} from "./index.js";

describe("tree impostor orbit gate", () => {
  it("keeps cylindrical billboard width stable across a full camera orbit", () => {
    const report = evaluateTreeImpostorOrbitWidthGate(new THREE.Vector3(0, 0, 0), 6, 32, 64);

    expect(report.status).toBe("pass");
    expect(report.minWidthRatio).toBeGreaterThan(0.99);
    expect(report.samples).toHaveLength(64);
  });

  it("keeps vertical trees world-up and does not roll cards", () => {
    const basis = treeImpostorCylindricalBillboardBasis(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 20, 3),
    );

    expect(basis.up.x).toBe(0);
    expect(basis.up.y).toBe(1);
    expect(basis.up.z).toBe(0);
    expect(Math.abs(basis.right.dot(basis.up))).toBeLessThan(1e-6);
    expect(Math.abs(basis.normal.dot(basis.up))).toBeLessThan(1e-6);
  });
});
