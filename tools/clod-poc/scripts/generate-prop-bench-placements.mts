/**
 * Generates fixed bench placement YAML files for custom props stress tests.
 * Run: npx tsx scripts/generate-prop-bench-placements.mts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dump } from "js-yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "config");
const assetIds = ["crate_a", "rock_large_01", "stone_ruin_wall"] as const;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateInstances(count: number, seed: number) {
  const rand = mulberry32(seed);
  const span = Math.ceil(Math.sqrt(count)) * 48;
  const instances = [];
  for (let i = 0; i < count; i++) {
    const assetId = assetIds[i % assetIds.length]!;
    instances.push({
      asset_id: assetId,
      position: [
        Math.round((rand() * 2 - 1) * span * 10) / 10,
        0,
        Math.round((rand() * 2 - 1) * span * 10) / 10,
      ],
      rotation_y: Math.round(rand() * 6.28 * 100) / 100,
      scale: assetId === "rock_large_01" ? 1.1 : 1,
      seed: seed + i,
      variation_id: i % 4,
    });
  }
  return instances;
}

for (const count of [500, 5000, 20000] as const) {
  const doc = {
    schema_version: 1,
    scene_id: `poc_bench_${count}`,
    instances: generateInstances(count, 9000 + count),
  };
  const outPath = join(root, `custom_prop_placements_${count}.yaml`);
  writeFileSync(outPath, dump(doc, { lineWidth: 120 }));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${count} instances)`);
}
