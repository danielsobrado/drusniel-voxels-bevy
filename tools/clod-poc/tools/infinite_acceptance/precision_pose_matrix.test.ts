import { describe, expect, it } from "vitest";
import { precisionPoseLandmarks, precisionPoseMatrix, precisionPoseSmokeMatrix } from "./precision_pose_matrix.js";

describe("continent precision pose matrix", () => {
  it("covers center, four cardinal rims, four diagonal rims, and three surface/altitude variants", () => {
    const matrix = precisionPoseMatrix();
    expect(matrix).toHaveLength(27);
    expect(new Set(matrix.map((pose) => pose.name))).toHaveLength(9);
    expect(new Set(matrix.map((pose) => pose.variant))).toEqual(new Set(["near-ground", "high-altitude", "water-specular"]));
    for (const name of ["northwest-rim", "northeast-rim", "southwest-rim", "southeast-rim"] as const) {
      const pose = matrix.find((entry) => entry.name === name)!;
      expect(Math.abs(pose.x)).toBe(8_000);
      expect(Math.abs(pose.z)).toBe(8_000);
    }
  });

  it("keeps a three-case smoke matrix and places two visible-target diagnostic landmarks per pose", () => {
    const smoke = precisionPoseSmokeMatrix();
    expect(smoke.map((pose) => pose.name)).toEqual(["center", "west-rim", "northwest-rim"]);
    for (const pose of smoke) {
      const landmarks = precisionPoseLandmarks(pose);
      expect(landmarks).toHaveLength(2);
      expect(landmarks[0]!.p).not.toEqual(landmarks[1]!.p);
    }
  });
});
