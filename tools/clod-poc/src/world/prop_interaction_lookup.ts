import {
  environmentalPropIdAtWorldPosition,
  type EnvironmentalPropLayer,
  type PropCandidateAddress,
} from "./prop_identity.js";

export interface EnvironmentalPropHit {
  readonly propId: string;
  readonly address: PropCandidateAddress;
  readonly worldPosition: readonly [number, number, number];
}

/** CPU re-derivation used after an instanced tree/stone raycast. */
export function lookupEnvironmentalPropHit(
  worldId: string,
  layer: EnvironmentalPropLayer,
  worldPosition: readonly [number, number, number],
  candidateSpacingM: number,
): EnvironmentalPropHit {
  const lookup = environmentalPropIdAtWorldPosition(worldId, layer, worldPosition[0], worldPosition[2], candidateSpacingM);
  return { ...lookup, worldPosition };
}

export function formatHoveredEnvironmentalProp(hit: EnvironmentalPropHit | null): string {
  return hit ? `propId ${hit.propId}` : "propId —";
}
