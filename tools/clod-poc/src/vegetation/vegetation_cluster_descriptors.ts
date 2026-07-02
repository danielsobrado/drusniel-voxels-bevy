export type VegetationKind = "tree" | "grass" | "understory";

export interface VegetationClusterDescriptor {
  id: number;
  kind: VegetationKind;
  ring: number;
  pageX: number;
  pageZ: number;
  centerX: number;
  centerZ: number;
  halfSize: number;
  minY: number;
  maxY: number;
  seed: number;
  densityBudget: number;
  terrainRevision: number;
}

export function vegetationClusterBounds(descriptor: VegetationClusterDescriptor): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  const halfSize = Math.max(0, descriptor.halfSize);
  return {
    minX: descriptor.centerX - halfSize,
    minZ: descriptor.centerZ - halfSize,
    maxX: descriptor.centerX + halfSize,
    maxZ: descriptor.centerZ + halfSize,
  };
}
