import { describe, expect, it } from "vitest";
import { RiverMistParticlePool } from "./riverMistParticlePool.js";

function particle(x: number, lifeS = 2) {
  return {
    x,
    y: 1,
    z: 2,
    vx: 1,
    vy: 0.5,
    vz: -1,
    lifeS,
    strength: 1,
  };
}

describe("RiverMistParticlePool", () => {
  it("uses a fixed capacity and overwrites without growing", () => {
    const pool = new RiverMistParticlePool(2.9);
    expect(pool.capacity).toBe(2);
    pool.spawn(particle(1));
    pool.spawn(particle(2));
    pool.spawn(particle(3));
    expect(pool.count).toBe(2);

    pool.advance(0.5);
    const positions = new Float32Array(6);
    const colors = new Float32Array(6);
    expect(pool.write(positions, colors, [1, 1, 1])).toBe(2);
    expect(Array.from(positions)).toContain(3.5);
    expect(colors.some((value) => value > 0)).toBe(true);
  });

  it("compacts expired particles and rejects invalid spawns", () => {
    const pool = new RiverMistParticlePool(4);
    pool.spawn(particle(1, 0.25));
    pool.spawn({ ...particle(2), x: Number.NaN });
    expect(pool.count).toBe(1);
    pool.advance(0.3);
    expect(pool.count).toBe(0);
  });
});
