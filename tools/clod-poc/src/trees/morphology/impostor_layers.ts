import {
  TREE_IMPOSTOR_AGE_BUCKETS,
  TREE_IMPOSTOR_LAYERS_PER_SPECIES,
  TREE_IMPOSTOR_STRUCTURAL_VARIANTS,
} from "./constants.js";

export interface ImpostorAgeLayerBlend {
  lowerBucket: number;
  upperBucket: number;
  blend: number;
}

export function impostorLayerIndex(structuralVariant: number, ageBucket: number): number {
  const variant = Math.max(0, Math.min(TREE_IMPOSTOR_STRUCTURAL_VARIANTS - 1, Math.floor(structuralVariant)));
  const bucket = Math.max(0, Math.min(TREE_IMPOSTOR_AGE_BUCKETS.length - 1, Math.floor(ageBucket)));
  return variant * TREE_IMPOSTOR_AGE_BUCKETS.length + bucket;
}

export function impostorAgeLayerBlend(age01: number): ImpostorAgeLayerBlend {
  const age = Math.max(0, Math.min(1, age01));
  if (age <= TREE_IMPOSTOR_AGE_BUCKETS[0]) return { lowerBucket: 0, upperBucket: 0, blend: 0 };
  const last = TREE_IMPOSTOR_AGE_BUCKETS.length - 1;
  if (age >= TREE_IMPOSTOR_AGE_BUCKETS[last]) return { lowerBucket: last, upperBucket: last, blend: 0 };
  for (let lower = 0; lower < last; lower++) {
    const upper = lower + 1;
    const a = TREE_IMPOSTOR_AGE_BUCKETS[lower];
    const b = TREE_IMPOSTOR_AGE_BUCKETS[upper];
    if (age <= b) return { lowerBucket: lower, upperBucket: upper, blend: (age - a) / (b - a) };
  }
  return { lowerBucket: last, upperBucket: last, blend: 0 };
}

export function validateImpostorLayerCount(layerCount: number): void {
  if (layerCount !== TREE_IMPOSTOR_LAYERS_PER_SPECIES) {
    throw new Error(`tree morphology impostor atlas requires ${TREE_IMPOSTOR_LAYERS_PER_SPECIES} layers; received ${layerCount}`);
  }
}
