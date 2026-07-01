export type VegetationVisibilityReason =
  | "visible"
  | "terrain_hidden"
  | "unknown_kept"
  | "near_forced_visible"
  | "disabled";

export interface TerrainHeightSample {
  height: number;
  unknown?: boolean;
}

export interface TerrainHeightSampler {
  sampleHeight(x: number, z: number): TerrainHeightSample;
}

export interface TerrainVisibilitySettings {
  enabled: boolean;
  minDistanceM: number;
  sampleCount: number;
  heightMarginM: number;
  crownHeightM: number;
}

export interface TerrainVisibilitySegmentQuery {
  sampler: TerrainHeightSampler | undefined;
  settings: TerrainVisibilitySettings;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetZ: number;
  targetGroundY: number;
  targetRadiusM: number;
}

export interface TerrainVisibilityResult {
  visible: boolean;
  reason: VegetationVisibilityReason;
  testedSamples: number;
}

export interface VegetationClusterVisibilityQuery extends TerrainVisibilitySegmentQuery {}

export interface VegetationVisibilityProvider {
  isClusterVisible(query: VegetationClusterVisibilityQuery): boolean;
  sampleTerrainVisibility(query: TerrainVisibilitySegmentQuery): TerrainVisibilityResult;
}

export function createVegetationVisibilityProvider(): VegetationVisibilityProvider {
  return {
    isClusterVisible: (query) => sampleTerrainVisibility(query).visible,
    sampleTerrainVisibility,
  };
}

export function sampleTerrainVisibility(query: TerrainVisibilitySegmentQuery): TerrainVisibilityResult {
  const { sampler, settings } = query;
  if (!settings.enabled) return { visible: true, reason: "disabled", testedSamples: 0 };
  if (!sampler) return { visible: true, reason: "unknown_kept", testedSamples: 0 };

  const dx = query.targetX - query.cameraX;
  const dz = query.targetZ - query.cameraZ;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance)) return { visible: true, reason: "unknown_kept", testedSamples: 0 };
  if (distance < Math.max(0, settings.minDistanceM)) return { visible: true, reason: "near_forced_visible", testedSamples: 0 };

  const sampleCount = Math.max(1, Math.floor(settings.sampleCount));
  const startY = query.cameraY;
  const endY = query.targetGroundY + Math.max(0, settings.crownHeightM) + Math.max(0, query.targetRadiusM) * 0.05;
  const margin = Math.max(0, settings.heightMarginM);

  for (let i = 1; i <= sampleCount; i++) {
    const t = i / (sampleCount + 1);
    const sample = sampler.sampleHeight(query.cameraX + dx * t, query.cameraZ + dz * t);
    if (sample.unknown || !Number.isFinite(sample.height)) {
      return { visible: true, reason: "unknown_kept", testedSamples: i };
    }
    const lineY = startY + (endY - startY) * t;
    if (sample.height > lineY + margin) {
      return { visible: false, reason: "terrain_hidden", testedSamples: i };
    }
  }

  return { visible: true, reason: "visible", testedSamples: sampleCount };
}
