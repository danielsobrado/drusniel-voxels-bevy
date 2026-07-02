import type { GrassTier } from "./grass_config.js";
import type { GrassSystem } from "./grass_system.js";

export const GRASS_DEPTH_PREPASS_TIER_MIN = 0;
export const GRASS_DEPTH_PREPASS_TIER_MAX = 2;
export const DEFAULT_GRASS_DEPTH_PREPASS_TIER = 2;

const TIER_LIMITS: Record<GrassTier, number> = {
  near: 1,
  mid: 2,
  far: 3,
  super: 4,
};

export function clampGrassDepthPrepassTier(tier: number): number {
  if (!Number.isFinite(tier)) return DEFAULT_GRASS_DEPTH_PREPASS_TIER;
  return Math.max(GRASS_DEPTH_PREPASS_TIER_MIN, Math.min(GRASS_DEPTH_PREPASS_TIER_MAX, Math.floor(tier)));
}

export function grassDepthPrepassTierLabel(tier: number): string {
  switch (clampGrassDepthPrepassTier(tier)) {
    case 0:
      return "off";
    case 1:
      return "near";
    case 2:
      return "near+mid";
    default:
      return "near+mid";
  }
}

interface MutableGrassSystem {
  useGrassPrepass: boolean;
  usesGpuRingPrepass: (tier: GrassTier) => boolean;
  rebuild: () => void;
}

export function applyGrassDepthPrepassTier(system: GrassSystem, tier: number, rebuild = true): number {
  const clampedTier = clampGrassDepthPrepassTier(tier);
  const mutable = system as unknown as MutableGrassSystem;
  mutable.useGrassPrepass = clampedTier > 0;
  mutable.usesGpuRingPrepass = (grassTier: GrassTier) => clampedTier > 0 && TIER_LIMITS[grassTier] <= clampedTier;
  if (rebuild) mutable.rebuild();
  return clampedTier;
}
