export const PROJECT_GENERATOR_QUERY_KEYS = Object.freeze([
  "water",
  "waterEnabled",
  "quality",
  "qualityPreset",
  "preset",
  "waterPerf",
  "waterPerformance",
  "waterLow",
  "waterQuality",
  "waterHq",
  "hydroUnified",
  "hydroUnifiedStartup",
  "continentHydrology",
  "continent_hydrology",
  "heightfieldRaster",
  "heightfield_raster",
  "customProps",
] as const);

export type ProjectGeneratorQueryKey = typeof PROJECT_GENERATOR_QUERY_KEYS[number];
export type ProjectGeneratorQuery = Partial<Record<ProjectGeneratorQueryKey, string>>;

const PROJECT_GENERATOR_QUERY_KEY_SET = new Set<string>(PROJECT_GENERATOR_QUERY_KEYS);
const MAX_QUERY_VALUE_LENGTH = 128;

function assertSafeQueryValue(value: unknown, key: string): asserts value is string {
  if (typeof value !== "string" || value.length > MAX_QUERY_VALUE_LENGTH) {
    throw new Error(`project.json world.generatorQuery.${key} is invalid`);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`project.json world.generatorQuery.${key} contains control characters`);
    }
  }
}

export function validateProjectGeneratorQuery(value: unknown): ProjectGeneratorQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("project.json world.generatorQuery is invalid");
  }
  const result: ProjectGeneratorQuery = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!PROJECT_GENERATOR_QUERY_KEY_SET.has(key)) {
      throw new Error(`project.json world.generatorQuery contains unsupported key ${key}`);
    }
    assertSafeQueryValue(rawValue, key);
    result[key as ProjectGeneratorQueryKey] = rawValue;
  }
  return result;
}

export function captureProjectGeneratorQuery(searchParams: URLSearchParams): ProjectGeneratorQuery {
  const result: ProjectGeneratorQuery = {};
  for (const key of PROJECT_GENERATOR_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

export function applyProjectGeneratorQuery(
  searchParams: URLSearchParams,
  query: ProjectGeneratorQuery,
): void {
  const validated = validateProjectGeneratorQuery(query);
  for (const key of PROJECT_GENERATOR_QUERY_KEYS) searchParams.delete(key);
  for (const key of PROJECT_GENERATOR_QUERY_KEYS) {
    const value = validated[key];
    if (value !== undefined) searchParams.set(key, value);
  }
}
