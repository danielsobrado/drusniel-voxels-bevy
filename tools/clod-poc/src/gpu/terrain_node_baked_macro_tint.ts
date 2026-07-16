import * as THREE from "three";

/**
 * Far CLOD tiers must keep the authored biome texture arrays as their albedo source.
 * The previous baked texture was a macro multiplier, but the material consumed it as
 * replacement albedo and flattened every far page into the same green tint.
 *
 * TODO: Re-enable a baked macro texture only after the far material multiplies it into
 * the sampled biome albedo instead of replacing that albedo.
 */
export function createBakedMacroTintTexture(
  _noiseA: THREE.Texture,
  _noiseB: THREE.Texture,
  _res = 256,
): THREE.DataTexture | null {
  return null;
}
