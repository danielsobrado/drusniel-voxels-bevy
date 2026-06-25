import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import { surfaceHeight } from "../terrain/terrain.js";
import {
  TWO_PI,
  type GrassSettings,
} from "./grass_config.js";
import type { GrassGenerationStats } from "./grass_stats.js";
import { acceptsGrassCandidate, hash2, randomSigned, sampleGrassTerrainSite } from "./grass_math.js";

export interface GrassBladeInstance {
  offset: [number, number, number];
  height: number;
  rotationY: number;
  phase: number;
  colorMix: number;
  edgeFade: number;
  normalY: number;
  terrainNormal: [number, number, number];
  widthScale?: number;
}

export function edgeFadeForCandidate(x: number, z: number, height: number, normalY: number, spacing: number): number {
  const sampleDistance = Math.max(0.75, spacing * 1.25);
  const samples = [
    surfaceHeight(x + sampleDistance, z),
    surfaceHeight(x - sampleDistance, z),
    surfaceHeight(x, z + sampleDistance),
    surfaceHeight(x, z - sampleDistance),
  ];
  const maxDelta = samples.reduce((max, neighbor) => Math.max(max, Math.abs(neighbor - height)), 0);
  const heightFade = 1 - THREE.MathUtils.smoothstep(maxDelta, 1.5, 4.5);
  const slopeFade = THREE.MathUtils.smoothstep(normalY, 0.55, 0.9);
  return THREE.MathUtils.clamp(heightFade * slopeFade, 0, 1);
}

export function generateGrassInstances(
  footprint: PageFootprint,
  settings: GrassSettings,
  maxBlades = settings.maxBlades,
  stats?: GrassGenerationStats,
): GrassBladeInstance[] {
  const rankedInstances: { priority: number; instance: GrassBladeInstance }[] = [];
  const spacing = Math.max(0.05, settings.bladeSpacing);
  const jitter = settings.placement.jitter;
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(maxBlades));
  const terrainPatchMode = settings.shaderMode !== "classic";

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (stats) stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + randomSigned(gridX, gridZ, settings.seed + 101) * spacing * jitter,
        footprint.minX + 0.001,
        footprint.maxX - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + randomSigned(gridX, gridZ, settings.seed + 211) * spacing * jitter,
        footprint.minZ + 0.001,
        footprint.maxZ - 0.001,
      );
      const site = sampleGrassTerrainSite(x, z, settings);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(gridX, gridZ, settings.seed + 307),
      })) continue;
      const edgeFade = terrainPatchMode ? edgeFadeForCandidate(x, z, site.height, site.normalY, spacing) : 1;
      if (terrainPatchMode && edgeFade < 0.18) {
        if (stats) stats.edgeSuppressedCandidates++;
        continue;
      }
      if (stats) stats.acceptedCandidates++;

      const heightScale = Math.max(
        0.1,
        1 + randomSigned(gridX, gridZ, settings.seed + 401) * settings.bladeHeightVariation,
      );
      rankedInstances.push({
        priority: hash2(gridX, gridZ, settings.seed + 809),
        instance: {
          offset: [x, site.height + 0.02, z],
          height: settings.bladeHeight * heightScale,
          rotationY: hash2(gridX, gridZ, settings.seed + 503) * TWO_PI,
          phase: hash2(gridX, gridZ, settings.seed + 601) * TWO_PI,
          colorMix: Math.min(1, Math.pow(hash2(gridX, gridZ, settings.seed + 701), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
          edgeFade,
          normalY: site.normalY,
          terrainNormal: site.terrainNormal,
        },
      });
    }
  }
  rankedInstances.sort((a, b) => a.priority - b.priority);
  return rankedInstances.slice(0, limit).map(({ instance }) => instance);
}
