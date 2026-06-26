import type { CanopyTerrainSampler } from "../canopy/canopy_terrain_sampler.js";
import type { NaadfIntegration } from "./integration.js";

let activeIntegration: NaadfIntegration | undefined;

export function setNaadfIntegration(integration: NaadfIntegration | undefined): void {
  activeIntegration = integration;
  if (typeof window === "undefined") return;
  const record = window as unknown as Record<string, unknown>;
  if (integration) record.__drusnielNaadf = integration;
  else delete record.__drusnielNaadf;
}

export function createNaadfCanopyTerrainSampler(integration: NaadfIntegration): CanopyTerrainSampler {
  return {
    sample(x: number, z: number) {
      const q = integration.queryHeight(x, z, "canopy");
      return {
        height: q.height,
        normal: { x: q.normalX, y: q.normalY, z: q.normalZ },
        slope: Math.max(0, Math.min(1, 1 - q.normalY)),
        materialHint: q.material,
        water: q.waterCoverage > 0.5,
      };
    },
  };
}

export function getNaadfIntegrationFromWindow(): NaadfIntegration | undefined {
  return activeIntegration;
}
