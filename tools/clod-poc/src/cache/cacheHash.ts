import type { ClodPagesConfig } from "../config.js";
import { sha256Hex } from "./checksum.js";

export interface CacheRelevantFarSettings {
  farReduceFactor: number;
}

const textEncoder = new TextEncoder();

async function hashJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  return sha256Hex(textEncoder.encode(json).buffer);
}

export async function computeCacheConfigHash(
  cfg: ClodPagesConfig,
  farSettings: CacheRelevantFarSettings,
): Promise<string> {
  const relevant = {
    page: {
      chunks_per_page: cfg.page.chunks_per_page,
      chunk_size: cfg.page.chunk_size,
      quadtree_levels: cfg.page.quadtree_levels,
    },
    simplify: {
      target_ratio_per_level: cfg.simplify.target_ratio_per_level,
      abandon_ratio: cfg.simplify.abandon_ratio,
      target_error: cfg.simplify.target_error,
      weld_epsilon_cells: cfg.simplify.weld_epsilon_cells,
      attribute_weights: cfg.simplify.attribute_weights,
    },
    far: {
      reduce_factor: farSettings.farReduceFactor,
    },
  };
  return hashJson(relevant);
}

export interface SourceHashInput {
  worldSeed: string;
  generatorVersion: string;
  worldPagesX: number;
  worldPagesZ: number;
  sourceRevision: string;
  pageX?: number;
  pageZ?: number;
  lod?: number;
  positions?: Float32Array;
  indices?: Uint32Array;
  materialWeights?: Float32Array;
}

export async function computeSourceRevisionPoC(input: {
  worldSeed: string;
  scene: string;
  worldPages: number;
  generatorVersion: string;
  digRevision: number;
}): Promise<string> {
  // TODO: replace PoC sourceRevision with production edit revision.
  return hashJson({
    worldSeed: input.worldSeed,
    scene: input.scene,
    worldPages: input.worldPages,
    generatorVersion: input.generatorVersion,
    digRevision: input.digRevision,
  });
}

export async function computePageSourceHash(input: SourceHashInput): Promise<string> {
  const content: Record<string, unknown> = {
    worldSeed: input.worldSeed,
    generatorVersion: input.generatorVersion,
    worldPagesX: input.worldPagesX,
    worldPagesZ: input.worldPagesZ,
    sourceRevision: input.sourceRevision,
    pageX: input.pageX,
    pageZ: input.pageZ,
    lod: input.lod,
    posCount: input.positions?.length ?? 0,
    indexCount: input.indices?.length ?? 0,
    matCount: input.materialWeights?.length ?? 0,
  };

  if (input.positions && input.positions.length > 0) {
    content.posDigest = await lightweightArrayDigest(input.positions);
  }
  if (input.indices && input.indices.length > 0) {
    content.idxDigest = await lightweightArrayDigest(input.indices);
  }
  if (input.materialWeights && input.materialWeights.length > 0) {
    content.matDigest = await lightweightArrayDigest(input.materialWeights);
  }

  return hashJson(content);
}

async function lightweightArrayDigest(arr: ArrayLike<number>): Promise<string> {
  const len = arr.length;
  if (len === 0) return "empty";
  const sampleCount = Math.min(64, len);
  const step = Math.max(1, Math.floor(len / sampleCount));
  const samples: number[] = [];
  let sum = 0;
  for (let i = 0; i < len; i += step) {
    const v = arr[i]!;
    samples.push(v);
    sum += v;
  }
  return hashJson({ len, sum, samples });
}
