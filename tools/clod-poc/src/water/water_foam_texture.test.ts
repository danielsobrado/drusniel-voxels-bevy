import { describe, expect, it } from "vitest";
import { buildWaterFoamNoiseData } from "./water_foam_texture.js";

describe("water foam noise texture", () => {
  it("is deterministic", () => {
    expect(buildWaterFoamNoiseData(32)).toEqual(buildWaterFoamNoiseData(32));
  });

  it("contains two non-flat decorrelated channels", () => {
    const data = buildWaterFoamNoiseData(32);
    const channelA: number[] = [];
    const channelB: number[] = [];
    for (let offset = 0; offset < data.length; offset += 4) {
      channelA.push(data[offset] ?? 0);
      channelB.push(data[offset + 1] ?? 0);
    }

    expect(variance(channelA)).toBeGreaterThan(120);
    expect(variance(channelB)).toBeGreaterThan(120);
    expect(channelA).not.toEqual(channelB);
  });

  it("is locally coherent instead of per-pixel hash noise", () => {
    const size = 64;
    const data = buildWaterFoamNoiseData(size);
    let delta = 0;
    let samples = 0;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const current = data[(y * size + x) * 4] ?? 0;
        const right = data[(y * size + ((x + 1) % size)) * 4] ?? 0;
        const down = data[(((y + 1) % size) * size + x) * 4] ?? 0;
        delta += Math.abs(current - right) + Math.abs(current - down);
        samples += 2;
      }
    }

    expect(delta / samples).toBeLessThan(18);
  });
});

function variance(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}
