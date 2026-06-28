import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BIOME_IDS, BIOME_REGION_CELL_M } from "../src/world_source/biome_region_field.js";
import { sampleBiomeSplat } from "../src/world_source/biome_splat.js";
import { ProceduralWorldSource } from "../src/world_source/world_source.js";
import { resolveTerrainFieldConfig } from "../src/terrain/terrain.js";

const CONTRACT_VERSION = 1;
const DEFAULT_OUTPUT = "tools/clod-poc/fixtures/world_source_golden_samples.json";
const SAMPLES_PER_BIOME = 10;
const SCAN_MIN_M = -6_000;
const SCAN_MAX_M = 6_000;
const SCAN_STEP_M = 240;

interface GoldenSampleRow {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  oceanMask: number;
  dominantLayer: string;
  splatWeights: { material: string; weight: number }[];
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function parseOutputPath(): string {
  const arg = process.argv.find((value) => value.startsWith("--out="));
  return resolve(arg ? arg.slice("--out=".length) : DEFAULT_OUTPUT);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sampleRow(source: ProceduralWorldSource, x: number, z: number): GoldenSampleRow {
  const height = source.sampleHeight(x, z);
  const biomeId = source.sampleBiome(x, z);
  const splat = sampleBiomeSplat(biomeId);
  return {
    x,
    z,
    height: round(height, 5),
    biomeId,
    oceanMask: round(source.oceanMask(x, z), 6),
    dominantLayer: splat.dominantLayer,
    splatWeights: splat.weights.map((entry) => ({
      material: entry.material,
      weight: round(entry.weight, 6),
    })),
  };
}

function collectRows(source: ProceduralWorldSource): GoldenSampleRow[] {
  const byBiome = new Map<number, GoldenSampleRow[]>();
  for (const biomeId of Object.values(BIOME_IDS)) byBiome.set(biomeId, []);

  for (let z = SCAN_MIN_M; z <= SCAN_MAX_M; z += SCAN_STEP_M) {
    for (let x = SCAN_MIN_M; x <= SCAN_MAX_M; x += SCAN_STEP_M) {
      const row = sampleRow(source, x, z);
      const rows = byBiome.get(row.biomeId);
      if (!rows || rows.length >= SAMPLES_PER_BIOME) continue;
      rows.push(row);
    }
  }

  const missing = [...byBiome.entries()]
    .filter(([, rows]) => rows.length < SAMPLES_PER_BIOME)
    .map(([biomeId, rows]) => `${biomeId}:${rows.length}/${SAMPLES_PER_BIOME}`);
  if (missing.length > 0) {
    throw new Error(`WorldSource golden sample scan did not find enough rows for biome ids: ${missing.join(", ")}`);
  }

  return [...byBiome.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, rows]) => rows)
    .sort((a, b) => a.biomeId - b.biomeId || a.z - b.z || a.x - b.x);
}

function main(): void {
  const terrain = resolveTerrainFieldConfig({
    seed: 0,
    seaLevel: 18,
    islandShape: {
      enabled: true,
      oceanRim: true,
      seed: 0,
      seaLevel: 18,
      worldRadiusM: 8192,
    },
  });
  const source = new ProceduralWorldSource(terrain);
  const rows = collectRows(source);
  const output = {
    contractVersion: CONTRACT_VERSION,
    generatedBy: "tools/clod-poc/scripts/export-world-source-golden.mts",
    metadata: {
      seed: source.metadata.seed,
      seaLevel: source.metadata.seaLevel,
      bounds: source.metadata.bounds,
      oceanRim: source.metadata.oceanRim,
      biomeRegionCellM: BIOME_REGION_CELL_M,
      samplesPerBiome: SAMPLES_PER_BIOME,
    },
    terrain: source.metadata.terrain,
    rows,
  };

  const outputPath = parseOutputPath();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, stableJson(output), "utf-8");
  console.log(`Wrote ${rows.length} WorldSource golden samples to ${outputPath}`);
}

main();
