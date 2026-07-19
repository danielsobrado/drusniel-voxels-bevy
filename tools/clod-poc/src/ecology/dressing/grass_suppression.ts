export interface GrassSuppressionPatch {
  readonly x: number;
  readonly z: number;
  /** Legacy inner suppression radius. */
  readonly radiusM?: number;
  readonly innerRadiusM?: number;
  readonly outerRadiusM?: number;
  readonly weight: number;
}

export interface GrassSuppressionSample {
  readonly density: number;
  readonly trample: number;
}

export interface GrassSuppressionField {
  set(id: string, patch: GrassSuppressionPatch): void;
  delete(id: string): void;
  clear(): void;
  sample(x: number, z: number): number;
  sampleContact(x: number, z: number): GrassSuppressionSample;
}

interface ResolvedGrassSuppressionPatch {
  readonly x: number;
  readonly z: number;
  readonly innerRadiusM: number;
  readonly outerRadiusM: number;
  readonly weight: number;
}

export function createGrassSuppressionField(): GrassSuppressionField {
  const patches = new Map<string, ResolvedGrassSuppressionPatch>();
  const sampleContact = (x: number, z: number): GrassSuppressionSample => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error("grass suppression sample coordinates must be finite");
    }
    let density = 1;
    let trample = 0;
    for (const patch of patches.values()) {
      const distance = Math.hypot(x - patch.x, z - patch.z);
      if (distance < patch.innerRadiusM) {
        const t = 1 - distance / patch.innerRadiusM;
        const influence = t * t * (3 - 2 * t);
        density *= 1 - patch.weight * influence;
        trample = Math.max(trample, patch.weight);
        continue;
      }
      if (distance >= patch.outerRadiusM || patch.outerRadiusM <= patch.innerRadiusM) continue;
      const t = 1 - (distance - patch.innerRadiusM) / (patch.outerRadiusM - patch.innerRadiusM);
      trample = Math.max(trample, patch.weight * t * t * (3 - 2 * t));
    }
    return {
      density: Math.max(0, Math.min(1, density)),
      trample: Math.max(0, Math.min(1, trample)),
    };
  };

  return {
    set(id, patch) {
      if (!id) throw new Error("grass suppression patch ID is required");
      const innerRadiusM = patch.innerRadiusM ?? patch.radiusM;
      const outerRadiusM = patch.outerRadiusM ?? innerRadiusM;
      const values = [patch.x, patch.z, innerRadiusM, outerRadiusM, patch.weight];
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("grass suppression patch values must be finite");
      }
      if (!(innerRadiusM! > 0)) throw new Error("grass suppression inner radius must be positive");
      if (!(outerRadiusM! >= innerRadiusM!)) {
        throw new Error("grass suppression outer radius must be greater than or equal to inner radius");
      }
      patches.set(id, {
        x: patch.x,
        z: patch.z,
        innerRadiusM: innerRadiusM!,
        outerRadiusM: outerRadiusM!,
        weight: Math.max(0, Math.min(1, patch.weight)),
      });
    },
    delete(id) {
      patches.delete(id);
    },
    clear() {
      patches.clear();
    },
    sample(x, z) {
      return sampleContact(x, z).density;
    },
    sampleContact,
  };
}
