import * as THREE from "three";
import type { WaterField } from "./waterField.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";

export interface RiverTerrainWetnessMaskOptions {
  resolution?: number;
  worldCells: number;
  field: WaterField;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, z: number, seed: number): number {
  const v = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return v - Math.floor(v);
}

export function buildRiverTerrainWetnessMask(options: RiverTerrainWetnessMaskOptions): THREE.DataTexture {
  const settings = readRiverMaterialSettings();
  const res = Math.max(16, Math.floor(options.resolution ?? 384));
  const worldCells = Math.max(1, options.worldCells);
  const data = new Uint8Array(res * res * 4);
  const searchRadius = Math.max(1.5, settings.wetBankDistanceM);
  const sampleOffsets = [
    [0, 0],
    [searchRadius * 0.5, 0], [-searchRadius * 0.5, 0], [0, searchRadius * 0.5], [0, -searchRadius * 0.5],
    [searchRadius, 0], [-searchRadius, 0], [0, searchRadius], [0, -searchRadius],
    [searchRadius * 0.7, searchRadius * 0.7], [-searchRadius * 0.7, searchRadius * 0.7],
    [searchRadius * 0.7, -searchRadius * 0.7], [-searchRadius * 0.7, -searchRadius * 0.7],
  ] as const;

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const worldX = ((x + 0.5) / res) * worldCells;
      const worldZ = ((z + 0.5) / res) * worldCells;
      const here = options.field.sample(worldX, worldZ);
      let wet = 0;
      let foam = 0;
      let droplets = 0;
      const dryBank = here.depth <= 0.08;

      for (const [ox, oz] of sampleOffsets) {
        const dist = Math.hypot(ox, oz);
        const s = options.field.sample(worldX + ox, worldZ + oz);
        if (s.depth <= 0 || s.bodyMask <= 0.04) continue;
        const edgeFade = 1 - clamp01(dist / Math.max(0.1, searchRadius));
        const river = smooth01(s.flow.speed / 0.14);
        const drop = smooth01((s.flow.drop - settings.foamResidueDropStart) / Math.max(0.25, settings.foamResidueDropStart + 1.0));
        const splash = Math.max(drop, smooth01(s.flow.speed / 0.9) * 0.48);
        wet = Math.max(wet, edgeFade * Math.max(s.bodyMask * 0.85, river * 0.75));
        foam = Math.max(foam, edgeFade * splash * settings.foamResidueStrength);
      }

      if (dryBank && wet > 0) {
        const n0 = hash2(x, z, 5);
        const n1 = hash2(Math.floor(x / 2), Math.floor(z / 2), 13);
        const n2 = hash2(Math.floor(x / 4), Math.floor(z / 4), 29);
        const patch = smooth01(n0 * 0.58 + n1 * 0.30 + n2 * 0.12);
        const puddleSpots = smooth01((patch - 0.52) / 0.42) * wet;
        droplets = Math.max(droplets, puddleSpots * settings.wetBankStrength);
        wet *= 0.72 + patch * 0.28;
      }

      const i = (z * res + x) * 4;
      data[i + 0] = Math.round(clamp01(wet * settings.wetBankStrength) * 255);
      data[i + 1] = Math.round(clamp01(foam) * 255);
      data[i + 2] = Math.round(clamp01(droplets) * 255);
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "river-terrain-wetness-mask";
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
