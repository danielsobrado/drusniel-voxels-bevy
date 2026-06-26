import { surfaceHeight } from "../terrain/terrain_surface.js";
import { WATER_LEVEL } from "../terrain/terrain_surface.js";
import { sampleMacroTerrainMaterial } from "../long-view/macroTerrain.js";
import { sampleMacroTerrainNormal } from "../long-view/macroTerrain.js";

export interface TerrainSourceSample {
  height: number;
  material: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  canopyCoverage: number;
  waterCoverage: number;
}

export interface TerrainSource {
  sample(x: number, z: number): TerrainSourceSample;
  sampleHeight(x: number, z: number): number;
  sampleMaterial(x: number, z: number): number;
  sampleCanopyCoverage(x: number, z: number): number;
  sampleWaterCoverage(x: number, z: number): number;
}

export type TerrainProfile = "flat" | "default" | "hills" | "mountains" | "forest";

function canopyFromTerrain(x: number, z: number, height: number, normalY: number): number {
  const forestNoise = Math.sin(x * 0.003 + z * 0.0027) * 0.5 + 0.5;
  const heightGate = height > 22 && height < 88 ? 1 : 0;
  const slopeGate = normalY > 0.55 ? 1 : 0;
  const valley = Math.max(0, 1 - Math.abs(height - 48) / 40);
  return Math.max(0, Math.min(1, forestNoise * heightGate * slopeGate * (0.4 + valley * 0.6)));
}

function waterFromHeight(height: number): number {
  return height < WATER_LEVEL ? Math.min(1, (WATER_LEVEL - height) / 4) : 0;
}

export function createTerrainSource(profile: TerrainProfile = "default", seed = 0): TerrainSource {
  const heightScale = profile === "flat" ? 0 : profile === "hills" ? 1 : profile === "mountains" ? 1.35 : 1;
  const heightOffset = profile === "flat" ? 32 : 0;

  const sampleHeightAt = (x: number, z: number): number => {
    if (profile === "flat") return heightOffset;
    const h = surfaceHeight(x + seed * 0.001, z - seed * 0.001);
    if (!Number.isFinite(h)) return heightOffset;
    return heightOffset + (h - 32) * heightScale;
  };

  const sample = (x: number, z: number): TerrainSourceSample => {
    const height = sampleHeightAt(x, z);
    const normal = sampleMacroTerrainNormal(x, z);
    const material = sampleMacroTerrainMaterial(x, z);
    const canopy = profile === "forest"
      ? Math.max(canopyFromTerrain(x, z, height, normal.y), 0.35)
      : canopyFromTerrain(x, z, height, normal.y);
    return {
      height,
      material,
      normalX: normal.x,
      normalY: normal.y,
      normalZ: normal.z,
      canopyCoverage: canopy,
      waterCoverage: waterFromHeight(height),
    };
  };

  return {
    sample,
    sampleHeight: (x, z) => sample(x, z).height,
    sampleMaterial: (x, z) => sample(x, z).material,
    sampleCanopyCoverage: (x, z) => sample(x, z).canopyCoverage,
    sampleWaterCoverage: (x, z) => sample(x, z).waterCoverage,
  };
}

export function sampleMacroFallback(x: number, z: number, source: TerrainSource): TerrainSourceSample {
  return source.sample(x, z);
}
