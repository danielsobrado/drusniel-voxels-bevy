import type { TreeInstanceMorphology } from "./types.js";
import { clampTreeInstanceMorphology } from "./validation.js";

export const VEGETATION_TREE_PREFIX_FLOATS = 12;
export const MORPHOLOGY_FLOATS = 12;
export const VEGETATION_TREE_INSTANCE_FLOATS = 24;
export const VEGETATION_TREE_INSTANCE_BYTES = VEGETATION_TREE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface VegetationTreeInstancePackingInput {
  positionScale: [number, number, number, number];
  rotationNormalY: [number, number, number, number];
  identity: [number, number, number, number];
  morphology: TreeInstanceMorphology;
}

export function packTreeInstanceMorphology(input: TreeInstanceMorphology): Float32Array {
  const value = clampTreeInstanceMorphology(input);
  return new Float32Array([
    value.age01, value.leanX, value.leanZ, value.health01,
    value.crownBiasX, value.crownBiasZ, value.crownWidth, value.crownFlattening,
    value.branchDroop, value.foliageDensity, value.rootFlare, value.stiffness,
  ]);
}

export function unpackTreeInstanceMorphology(input: ArrayLike<number>, offset = 0): TreeInstanceMorphology {
  return clampTreeInstanceMorphology({
    age01: Number(input[offset]),
    leanX: Number(input[offset + 1]),
    leanZ: Number(input[offset + 2]),
    health01: Number(input[offset + 3]),
    crownBiasX: Number(input[offset + 4]),
    crownBiasZ: Number(input[offset + 5]),
    crownWidth: Number(input[offset + 6]),
    crownFlattening: Number(input[offset + 7]),
    branchDroop: Number(input[offset + 8]),
    foliageDensity: Number(input[offset + 9]),
    rootFlare: Number(input[offset + 10]),
    stiffness: Number(input[offset + 11]),
  });
}

export function packVegetationTreeInstance(input: VegetationTreeInstancePackingInput): ArrayBuffer {
  const buffer = new ArrayBuffer(VEGETATION_TREE_INSTANCE_BYTES);
  const floats = new Float32Array(buffer);
  floats.set(input.positionScale, 0);
  floats.set(input.rotationNormalY, 4);
  new Uint32Array(buffer).set(input.identity.map((value) => value >>> 0), 8);
  floats.set(packTreeInstanceMorphology(input.morphology), VEGETATION_TREE_PREFIX_FLOATS);
  return buffer;
}
