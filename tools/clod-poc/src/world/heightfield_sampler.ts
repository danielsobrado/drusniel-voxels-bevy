import { baseSurfaceHeight } from "../terrain/terrain_surface.js";
import {
  makeStartupHeightfieldSampler,
  type StartupHeightfieldRaster,
} from "../terrain/startup_heightfield_raster.js";

export interface HeightfieldDomain {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export type HeightfieldSamplerKind = "procedural" | "startup_raster" | "heightfield_tiles";

/**
 * Canonical surface-height sampling contract.
 *
 * Integer-lattice reads may come from exact caches. Fractional reads must retain the
 * canonical field semantics until a later terrain-source version explicitly changes authority.
 */
export interface HeightfieldSampler {
  sampleHeight(x: number, z: number): number;
  readonly domain: HeightfieldDomain | null;
  readonly sourceRevision: number;
  readonly kind: HeightfieldSamplerKind;
}

export function proceduralHeightfieldSampler(sourceRevision = 0): HeightfieldSampler {
  return Object.freeze({
    kind: "procedural" as const,
    domain: null,
    sourceRevision,
    sampleHeight: baseSurfaceHeight,
  });
}

export function startupRasterHeightfieldSampler(
  raster: StartupHeightfieldRaster,
  sourceRevision = 0,
): HeightfieldSampler {
  const sampleHeight = makeStartupHeightfieldSampler(raster);
  const maxExclusive = raster.minCell + raster.res;
  return Object.freeze({
    kind: "startup_raster" as const,
    domain: Object.freeze({
      minX: raster.minCell,
      minZ: raster.minCell,
      maxX: maxExclusive,
      maxZ: maxExclusive,
    }),
    sourceRevision,
    sampleHeight,
  });
}
