import { describe, expect, it } from "vitest";
import { RiverMistParticlePool } from "./riverMistParticlePool.js";

function spawn(pool: RiverMistParticlePool, x: number, lifeS = 2): void {
  pool.spawn(x, 1, 2, 1, 0.5, -1, lifeS, 1);
}

describe("RiverMistParticlePool", () => {
  it("uses a fixed capacity and overwrites without growing", () => {
    const pool = new RiverMistParticlePool(2.9);
    expect(pool.capacity).toBe(2);
    spawn(pool, 1);
    spawn(pool, 2);
    spawn(pool, 3);
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
    spawn(pool, 1, 0.25);
    pool.spawn(Number.NaN, 1, 2, 1, 0.5, -1, 2, 1);
    expect(pool.count).toBe(1);
    pool.advance(0.3);
    expect(pool.count).toBe(0);
  });
});
