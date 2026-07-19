import type { RiverMaterialSettings } from "./riverMaterialRuntime.js";
import type { RiverDressingSample } from "./riverDressingSampleReader.js";

interface ResidueSample {
  readonly x: number;
  readonly z: number;
  readonly wet: number;
  readonly foam: number;
  readonly drop: number;
  readonly radius: number;
  readonly angle: number;
  readonly slopeFade: number;
}

export interface RiverBankResidueSampler {
  sampleRiver(x: number, z: number): RiverDressingSample | null;
  surfaceHeight(x: number, z: number): number | null;
  surfaceNormalY(x: number, z: number, stepM: number): number | null;
}

export interface ResidueGeometry {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly drawCount: number;
}

interface MutableResidueGeometry {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  drawCount: number;
  writtenSamples: number;
}

export interface RiverBankResidueBuildResult {
  readonly wet: ResidueGeometry;
  readonly foam: ResidueGeometry;
}

export interface RiverBankResidueBuildJob {
  step(cellBudget?: number, decalBudget?: number): RiverBankResidueBuildResult | null;
}

export const RIVER_BANK_RESIDUE_SCAN_CELLS_PER_FRAME = 8;
export const RIVER_BANK_RESIDUE_DECALS_PER_FRAME = 64;

const SAMPLE_GRID = 25;
const SAMPLE_SPACING_M = 3.25;
const MAX_WET_DECALS = 360;
const MAX_FOAM_DECALS = 180;
const NORMAL_SAMPLE_STEP_M = 1.2;
const DECAL_SURFACE_OFFSET_M = 0.055;

export function createRiverBankResidueBuildJob(
  sampler: RiverBankResidueSampler,
  settings: RiverMaterialSettings,
  centerX: number,
  centerZ: number,
): RiverBankResidueBuildJob {
  const wet: ResidueSample[] = [];
  const foam: ResidueSample[] = [];
  const half = Math.floor(SAMPLE_GRID / 2);
  const distM = Math.max(0.5, settings.wetBankDistanceM);
  const offsets = bankProbeOffsets(distM);
  const totalCells = SAMPLE_GRID * SAMPLE_GRID;
  let cellIndex = settings.wetBankStrength <= 0 && settings.foamResidueStrength <= 0 ? totalCells : 0;
  let wetIndex = 0;
  let foamIndex = 0;
  let wetGeometry: MutableResidueGeometry | null = null;
  let foamGeometry: MutableResidueGeometry | null = null;

  const scanCell = (index: number): void => {
    const gx = index % SAMPLE_GRID - half;
    const gz = Math.floor(index / SAMPLE_GRID) - half;
    const cellX = Math.round(centerX / SAMPLE_SPACING_M) + gx;
    const cellZ = Math.round(centerZ / SAMPLE_SPACING_M) + gz;
    const jx = hash2(cellX, cellZ, 11) - 0.5;
    const jz = hash2(cellX, cellZ, 23) - 0.5;
    const x = (cellX + 0.5 + jx * 0.45) * SAMPLE_SPACING_M;
    const z = (cellZ + 0.5 + jz * 0.45) * SAMPLE_SPACING_M;
    const here = sampler.sampleRiver(x, z);
    if (!here || here.depth > 0.04) return;

    const normalY = sampler.surfaceNormalY(x, z, NORMAL_SAMPLE_STEP_M);
    if (normalY === null) return;
    const slopeFade = smooth01((normalY - 0.35) / 0.45);
    if (slopeFade <= 0.02) return;

    const signals = bankSignals(sampler, settings, x, z, offsets, distM);
    const patchNoise = hash2(cellX, cellZ, 37);
    const puddleNoise = hash2(Math.floor(cellX / 2), Math.floor(cellZ / 2), 53);
    const wetStrength = signals.wet * settings.wetBankStrength * slopeFade;
    const foamStrength = signals.foam * settings.foamResidueStrength * slopeFade;
    const dropPatch = smooth01((patchNoise * 0.62 + puddleNoise * 0.38 - 0.48) / 0.46) * wetStrength;
    const angle = Math.atan2(signals.dirZ, signals.dirX) + (hash2(cellX, cellZ, 61) - 0.5) * 0.75;
    const radius = 0.55 + hash2(cellX, cellZ, 71) * 1.65;

    if (
      wet.length < MAX_WET_DECALS
      && wetStrength > 0.08
      && patchNoise < Math.min(0.95, wetStrength + dropPatch * 0.35)
    ) {
      wet.push({
        x,
        z,
        wet: Math.min(1, wetStrength),
        foam: 0,
        drop: Math.min(1, dropPatch),
        radius,
        angle,
        slopeFade,
      });
    }

    if (
      foam.length < MAX_FOAM_DECALS
      && foamStrength > 0.10
      && hash2(cellX, cellZ, 41) < Math.min(0.82, foamStrength)
    ) {
      foam.push({
        x,
        z,
        wet: 0,
        foam: Math.min(1, foamStrength),
        drop: 0,
        radius: radius * 0.78,
        angle,
        slopeFade,
      });
    }
  };

  return {
    step(
      cellBudget = RIVER_BANK_RESIDUE_SCAN_CELLS_PER_FRAME,
      decalBudget = RIVER_BANK_RESIDUE_DECALS_PER_FRAME,
    ): RiverBankResidueBuildResult | null {
      const cellEnd = Math.min(totalCells, cellIndex + Math.max(1, cellBudget));
      while (cellIndex < cellEnd) scanCell(cellIndex++);
      if (cellIndex < totalCells) return null;

      wetGeometry ??= createResidueGeometry(wet.length);
      foamGeometry ??= createResidueGeometry(foam.length);
      let remaining = Math.max(1, decalBudget);
      if (wetIndex < wet.length) {
        const next = writeDecals(sampler, wet, "wet", wetGeometry, wetIndex, remaining);
        remaining -= next - wetIndex;
        wetIndex = next;
      }
      if (remaining > 0 && foamIndex < foam.length) {
        foamIndex = writeDecals(sampler, foam, "foam", foamGeometry, foamIndex, remaining);
      }
      return wetIndex >= wet.length && foamIndex >= foam.length
        ? { wet: wetGeometry, foam: foamGeometry }
        : null;
    },
  };
}

function bankSignals(
  sampler: RiverBankResidueSampler,
  settings: RiverMaterialSettings,
  x: number,
  z: number,
  offsets: readonly (readonly [number, number])[],
  distanceM: number,
): { wet: number; foam: number; dirX: number; dirZ: number } {
  let bestWet = 0;
  let bestFoam = 0;
  let bestDirX = 1;
  let bestDirZ = 0;

  for (const [offsetX, offsetZ] of offsets) {
    const sample = sampler.sampleRiver(x + offsetX, z + offsetZ);
    if (!sample || sample.depth <= 0 || sample.wetMask <= 0.05) continue;
    const distanceFade = 1 - Math.min(
      1,
      Math.hypot(offsetX, offsetZ) / Math.max(0.01, distanceM * 1.2),
    );
    const river = smooth01(sample.flowStrength / 0.12);
    const wetSignal = distanceFade * Math.max(sample.wetMask, river * 0.8);
    const dropFoam = smooth01(
      (sample.bedDrop - settings.foamResidueDropStart)
      / Math.max(0.1, settings.foamResidueDropStart + 0.8),
    );
    const speedFoam = smooth01(sample.flowStrength / 0.85);
    if (wetSignal > bestWet) {
      bestWet = wetSignal;
      bestDirX = sample.flowX || offsetX;
      bestDirZ = sample.flowZ || offsetZ;
    }
    bestFoam = Math.max(bestFoam, wetSignal * Math.max(dropFoam, speedFoam * 0.42));
  }

  return { wet: bestWet, foam: bestFoam, dirX: bestDirX, dirZ: bestDirZ };
}

function createResidueGeometry(sampleCount: number): MutableResidueGeometry {
  const vertexCount = Math.max(1, sampleCount * 6);
  return {
    positions: new Float32Array(vertexCount * 3),
    colors: new Float32Array(vertexCount * 3),
    drawCount: 0,
    writtenSamples: 0,
  };
}

function writeDecals(
  sampler: RiverBankResidueSampler,
  samples: readonly ResidueSample[],
  kind: "wet" | "foam",
  geometry: MutableResidueGeometry,
  start: number,
  count: number,
): number {
  const end = Math.min(samples.length, start + count);
  for (let index = start; index < end; index += 1) {
    const sample = samples[index]!;
    if (!writeDecalPositions(sampler, sample, kind, geometry)) continue;
    writeDecalColors(sample, kind, geometry);
    geometry.writtenSamples += 1;
    geometry.drawCount = geometry.writtenSamples * 6;
  }
  return end;
}

function writeDecalPositions(
  sampler: RiverBankResidueSampler,
  sample: ResidueSample,
  kind: "wet" | "foam",
  geometry: MutableResidueGeometry,
): boolean {
  const rx = sample.radius * (kind === "wet" ? 1.45 : 1.10);
  const rz = sample.radius * (kind === "wet" ? 0.82 : 0.48);
  const cosAngle = Math.cos(sample.angle);
  const sinAngle = Math.sin(sample.angle);
  const targetOffset = geometry.writtenSamples * 18;
  const pending = new Float32Array(18);

  const corners = decalCorners(rx, rz);
  for (let index = 0; index < corners.length; index += 1) {
    const [localX, localZ] = corners[index]!;
    const worldX = sample.x + localX * cosAngle - localZ * sinAngle;
    const worldZ = sample.z + localX * sinAngle + localZ * cosAngle;
    const terrainY = sampler.surfaceHeight(worldX, worldZ);
    if (terrainY === null) return false;
    const vertex = index * 3;
    pending[vertex] = worldX;
    pending[vertex + 1] = terrainY + DECAL_SURFACE_OFFSET_M;
    pending[vertex + 2] = worldZ;
  }

  geometry.positions.set(pending, targetOffset);
  return true;
}

function writeDecalColors(
  sample: ResidueSample,
  kind: "wet" | "foam",
  geometry: MutableResidueGeometry,
): void {
  const strength = (kind === "wet" ? Math.max(sample.wet, sample.drop) : sample.foam)
    * sample.slopeFade;
  const targetOffset = geometry.writtenSamples * 18;
  for (let corner = 0; corner < 6; corner += 1) {
    const vertex = targetOffset + corner * 3;
    if (kind === "wet") {
      const dropTint = sample.drop * 0.05;
      geometry.colors[vertex] = 0.030 + strength * 0.030 + dropTint;
      geometry.colors[vertex + 1] = 0.040 + strength * 0.045 + dropTint;
      geometry.colors[vertex + 2] = 0.034 + strength * 0.048 + dropTint;
    } else {
      geometry.colors[vertex] = 0.68 + strength * 0.22;
      geometry.colors[vertex + 1] = 0.76 + strength * 0.18;
      geometry.colors[vertex + 2] = 0.72 + strength * 0.18;
    }
  }
}

function bankProbeOffsets(distanceM: number): readonly (readonly [number, number])[] {
  return [
    [distanceM, 0],
    [-distanceM, 0],
    [0, distanceM],
    [0, -distanceM],
    [distanceM * 0.7, distanceM * 0.7],
    [-distanceM * 0.7, distanceM * 0.7],
    [distanceM * 0.7, -distanceM * 0.7],
    [-distanceM * 0.7, -distanceM * 0.7],
    [distanceM * 0.45, distanceM * 0.2],
    [-distanceM * 0.45, -distanceM * 0.2],
  ];
}

function decalCorners(rx: number, rz: number): readonly (readonly [number, number])[] {
  return [
    [-rx, -rz],
    [rx, rz],
    [rx, -rz],
    [-rx, -rz],
    [-rx, rz],
    [rx, rz],
  ];
}

function hash2(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
