export const PROCEDURAL_SEED_STREAM_IDS = [
  "noise_value",
  "noise_fbm",
  "noise_ridged",
  "noise_worley",
  "material_macro",
  "material_meso",
  "material_micro",
] as const;

export type ProceduralSeedStreamId = typeof PROCEDURAL_SEED_STREAM_IDS[number];

export type ProceduralSeedStreams = Record<ProceduralSeedStreamId, number>;

export function stableSeedStream(rootSeed: number, stream: string): number {
  let hash = (rootSeed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < stream.length; i++) {
    hash ^= stream.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function deriveSeedStreams(rootSeed: number): ProceduralSeedStreams {
  return Object.fromEntries(PROCEDURAL_SEED_STREAM_IDS.map((id) => [id, stableSeedStream(rootSeed, id)])) as ProceduralSeedStreams;
}
