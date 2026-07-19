import { describe, expect, it } from "vitest";
import { DeterministicSequenceClock } from "./sequence_clock.js";

const config = {
  frames: 5,
  stepSeconds: 1 / 60,
  path: {
    start: { p: [10, 20, 30] as [number, number, number], yaw: 3.1, pitch: -0.2, fov: 55 },
    end: { p: [14, 22, 38] as [number, number, number], yaw: -3.1, pitch: -0.4, fov: 60 },
  },
};

describe("DeterministicSequenceClock", () => {
  it("emits byte-identical pose and simulation state streams", () => {
    const capture = () => {
      const clock = new DeterministicSequenceClock(config);
      return JSON.stringify(Array.from({ length: config.frames }, (_, index) => clock.step(index)));
    };
    expect(capture()).toBe(capture());
  });

  it("takes the shortest path across the yaw wrap", () => {
    const clock = new DeterministicSequenceClock(config);
    const midpoint = clock.step(2).pose.yaw;
    expect(Math.abs(midpoint)).toBeGreaterThan(3);
  });

  it("rejects invalid frame indices", () => {
    const clock = new DeterministicSequenceClock(config);
    expect(() => clock.step(5)).toThrow(/outside/);
  });
});
