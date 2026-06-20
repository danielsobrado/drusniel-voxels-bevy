export const PROCEDURAL_TEXTURE_SCHEMA_VERSION = 3;

export interface ProceduralTextureManifest {
  schemaVersion: number;
  seed: number;
  configHash: string;
  shaderHash: string;
  generatedAt: string;
  noiseResolution: number;
  layerResolution: number;
  materialOrder: string[];
  outputs: ProceduralTextureManifestOutputs;
}

export interface ProceduralTextureManifestOutputs {
  noiseA: string;
  noiseB: string;
  classificationA: string;
  terrainAlbedo: string[];
  terrainNormalRoughness: string[];
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

function textureProducingConfig(config: unknown): unknown {
  const record = config && typeof config === "object" ? config as Record<string, unknown> : {};
  return {
    noise: record.noise,
    terrain: record.terrain,
    supportMaps: record.support_maps,
  };
}

export function createProceduralTextureManifest(input: {
  seed: number;
  config: unknown;
  shaderInput?: unknown;
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
      textureConfig: textureProducingConfig(input.config),
    }),
    shaderHash: stableHash(input.shaderInput ?? "clod-poc-procedural-terrain-shader-v1"),
    generatedAt: input.generatedAt ?? "runtime",
    noiseResolution: input.noiseResolution,
    layerResolution: input.layerResolution,
    materialOrder: [...input.materialOrder],
    outputs: {
      noiseA: "noise_a.png",
      noiseB: "noise_b.png",
      classificationA: "classification_a.png",
      terrainAlbedo: input.materialOrder.map((id) => `${id}_albedo.png`),
      terrainNormalRoughness: input.materialOrder.map((id) => `${id}_normal_roughness.png`),
    },
  };
}
