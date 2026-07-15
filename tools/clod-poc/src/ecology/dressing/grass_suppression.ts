export interface GrassSuppressionPatch {
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly weight: number;
}

export interface GrassSuppressionField {
  set(id: string, patch: GrassSuppressionPatch): void;
  delete(id: string): void;
  clear(): void;
  sample(x: number, z: number): number;
}

export function createGrassSuppressionField(): GrassSuppressionField {
  const patches = new Map<string, GrassSuppressionPatch>();
  return {
    set(id, patch) {
      if (!id) throw new Error("grass suppression patch ID is required");
      if (![patch.x, patch.z, patch.radiusM, patch.weight].every(Number.isFinite)) {
        throw new Error("grass suppression patch values must be finite");
      }
      if (!(patch.radiusM > 0)) throw new Error("grass suppression radius must be positive");
      patches.set(id, { ...patch, weight: Math.max(0, Math.min(1, patch.weight)) });
    },
    delete(id) {
      patches.delete(id);
    },
    clear() {
      patches.clear();
    },
    sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error("grass suppression sample coordinates must be finite");
      let density = 1;
      for (const patch of patches.values()) {
        const distance = Math.hypot(x - patch.x, z - patch.z);
        if (distance >= patch.radiusM) continue;
        const t = 1 - distance / patch.radiusM;
        density *= 1 - patch.weight * t * t * (3 - 2 * t);
      }
      return Math.max(0, Math.min(1, density));
    },
  };
}
