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

  it("starts finite scenes close enough to expose several terrain levels", () => {
    const worldCells = 1024;
    const pose = defaultStartupCameraPose(null, worldCells);

    expect(pose.eye).toEqual([
      worldCells * 0.5,
      worldCells * 0.45,
      worldCells * 1.32,
    ]);
    expect(pose.target).toEqual([worldCells * 0.5, 30, worldCells * 0.5]);
  });

  it("frames the deterministic cave entrance from outside", () => {
    const pose = defaultStartupCameraPose("cave-test", 1024);
    expect(pose.eye[2]).toBeLessThan(pose.target[2]);
    expect(pose.target[0]).toBe(720);
  });
});
