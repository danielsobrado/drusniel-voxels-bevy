export const PROCEDURAL_TEXTURE_SCHEMA_VERSION = 1;

export interface ProceduralTextureManifest {
  schemaVersion: number;
  seed: number;
  configHash: string;
  generatedAt: string;
  noiseResolution: number;
  layerResolution: number;
  materialOrder: string[];
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createProceduralTextureManifest(input: {
  seed: number;
  config: unknown;
  noiseResolution: number;
  layerResolution: number;
  materialOrder: string[];
  generatedAt?: string;
}): ProceduralTextureManifest {
  return {
    schemaVersion: PROCEDURAL_TEXTURE_SCHEMA_VERSION,
    seed: input.seed,
    configHash: stableHash({
      schemaVersion: PROCEDURAL_TEXTURE_SCHEMA_VERSION,
      seed: input.seed,
      config: input.config,
    }),
    generatedAt: input.generatedAt ?? "runtime",
    noiseResolution: input.noiseResolution,
    layerResolution: input.layerResolution,
    materialOrder: [...input.materialOrder],
  };
}
