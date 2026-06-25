import type { Phase1Heightfield } from "./terrain_synthesis.js";

export interface HeightfieldSample {
  height: number;
  slope: number;
  flow: number;
  biome: number;
  materialWeights: [number, number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class HeightfieldSampler {
  constructor(readonly field: Phase1Heightfield) {}

  worldToGrid(x: number, z: number): [number, number] {
    const max = this.field.size - 1;
    return [
      clamp((x / this.field.worldSizeM) * max, 0, max),
      clamp((z / this.field.worldSizeM) * max, 0, max),
    ];
  }

  sample(x: number, z: number): HeightfieldSample {
    const [gx, gz] = this.worldToGrid(x, z);
    return {
      height: this.sampleArray(this.field.heights, gx, gz),
      slope: this.sampleArray(this.field.slope, gx, gz),
      flow: this.sampleArray(this.field.flow, gx, gz),
      biome: Math.round(this.sampleArray(this.field.biome, gx, gz)),
      materialWeights: this.sampleMaterialWeights(gx, gz),
    };
  }

  private sampleMaterialWeights(gx: number, gz: number): [number, number, number, number] {
    const weights: [number, number, number, number] = [0, 0, 0, 0];
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      weights[slot] = this.sampleInterleaved(this.field.materialWeights, gx, gz, 4, slot);
      sum += weights[slot];
    }
    if (sum > Number.EPSILON) {
      for (let slot = 0; slot < 4; slot += 1) weights[slot] /= sum;
    }
    return weights;
  }

  normalAt(x: number, z: number): [number, number, number] {
    const step = this.field.worldSizeM / (this.field.size - 1);
    const hx0 = this.sample(x - step, z).height;
    const hx1 = this.sample(x + step, z).height;
    const hz0 = this.sample(x, z - step).height;
    const hz1 = this.sample(x, z + step).height;
    const nx = hx0 - hx1;
    const ny = step * 2;
    const nz = hz0 - hz1;
    const inv = 1 / Math.max(0.000001, Math.hypot(nx, ny, nz));
    return [nx * inv, ny * inv, nz * inv];
  }

  private sampleArray(array: Float32Array | Uint8Array, gx: number, gz: number): number {
    const size = this.field.size;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(size - 1, x0 + 1);
    const z1 = Math.min(size - 1, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const a = array[z0 * size + x0] ?? 0;
    const b = array[z0 * size + x1] ?? 0;
    const c = array[z1 * size + x0] ?? 0;
    const d = array[z1 * size + x1] ?? 0;
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }

  private sampleInterleaved(
    array: Float32Array,
    gx: number,
    gz: number,
    stride: number,
    slot: number,
  ): number {
    const size = this.field.size;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(size - 1, x0 + 1);
    const z1 = Math.min(size - 1, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const a = array[(z0 * size + x0) * stride + slot] ?? 0;
    const b = array[(z0 * size + x1) * stride + slot] ?? 0;
    const c = array[(z1 * size + x0) * stride + slot] ?? 0;
    const d = array[(z1 * size + x1) * stride + slot] ?? 0;
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }
}
