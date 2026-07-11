import { describe, expect, it } from "vitest";
import { defaultStartupCameraPose } from "./infinite_islands_startup_camera.js";

describe("infinite-islands startup camera", () => {
  it("anchors the initial streaming center to the bootstrap terrain midpoint", () => {
    const worldCells = 1024;
    const pose = defaultStartupCameraPose("infinite-islands", worldCells);

    expect(pose.eye[0]).toBe(worldCells * 0.5);
    expect(pose.eye[2]).toBe(worldCells * 0.5);
    expect(pose.target[2]).toBeLessThan(pose.eye[2]);
  });

  it("preserves the legacy default pose for finite scenes", () => {
    const worldCells = 1024;
    const pose = defaultStartupCameraPose(null, worldCells);

    expect(pose.eye).toEqual([
      worldCells * 0.5,
      worldCells * 0.7,
      worldCells * 1.6,
    ]);
    expect(pose.target).toEqual([worldCells * 0.5, 24, worldCells * 0.5]);
  });
});
