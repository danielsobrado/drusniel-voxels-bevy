import { SAVE_ID_HASH_MASK, SAVE_ID_PREFIX } from "./save_config.js";

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new Error(`save id seed must be finite: ${seed}`);
  return Math.trunc(seed) >>> 0;
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function createSaveIdFactory(seed: number, prefix = SAVE_ID_PREFIX): () => string {
  const normalizedSeed = normalizeSeed(seed);
  if (!prefix || !/^[a-z][a-z0-9_-]*$/i.test(prefix)) throw new Error(`invalid save id prefix: ${prefix}`);
  let counter = 0;

  return () => {
    counter += 1;
    const sequence = counter.toString(36).padStart(6, "0");
    const suffix = (mix32(normalizedSeed ^ counter) & SAVE_ID_HASH_MASK).toString(16).padStart(4, "0");
    return `${prefix}_${sequence}_${suffix}`;
  };
}

export function isFactorySaveId(id: string, prefix = SAVE_ID_PREFIX): boolean {
  const parts = id.split("_");
  return parts.length === 3 && parts[0] === prefix && /^[0-9a-z]{6,}$/.test(parts[1]) && /^[0-9a-f]{4}$/.test(parts[2]);
}
