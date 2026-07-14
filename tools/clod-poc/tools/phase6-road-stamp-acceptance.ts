import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { validateCriticalPaths } from "../src/save/critical_path_validation.js";
import type { WorldMetadataRecord } from "../src/save/save_schema.js";
import { compileFeatureStamps } from "../src/world/feature_stamps.js";
import { buildHeightfieldTile } from "../src/world/heightfield_tiles/heightfield_tile.js";

const outDir = path.resolve("shots/phase-6");
const pngPath = path.join(outDir, "road-stamp.png");
const statsPath = path.join(outDir, "road-stamp-stats.json");
const metadata: WorldMetadataRecord = {
  schemaVersion: 2,
  cities: [], districts: [], caveEntrances: [], caveSystems: [], revision: 1,
  roads: [{
    id: "hill-road", points: [[0, 18, 128], [256, 18, 128]], widthM: 10,
    materialId: 1, roadType: "dirt", connectedCityIds: [], criticalPathId: "main-route", revision: 1,
  }],
  criticalPaths: [{
    id: "main-route", name: "Hill Route", purpose: "mainQuest", points: [[0, 18, 128], [256, 18, 128]],
    linkedRoadIds: ["hill-road"], linkedPropIds: [], mustRemainPassable: true, status: "valid", revision: 1,
  }],
};
const features = compileFeatureStamps(metadata);
const baseHeight = (x: number, z: number): number => 10 + 55 * Math.exp(-(((x - 128) ** 2) + ((z - 128) ** 2)) / 5200);
const tile = buildHeightfieldTile({ x: 0, z: 0 }, {
  sampleHeight: (x, z) => features.sampleHeight(x, z, baseHeight(x, z)),
});
const image = new Uint8Array(256 * 256 * 3);
let excludedSamples = 0;
for (let z = 0; z < 256; z++) {
  for (let x = 0; x < 256; x++) {
    const height = tile.heights[z * tile.res + x] ?? 0;
    const shade = Math.max(0, Math.min(255, Math.round((height / 70) * 255)));
    const excluded = features.excludesScatter(x + 0.5, z + 0.5);
    if (excluded) excludedSamples++;
    const offset = (z * 256 + x) * 3;
    image[offset] = excluded ? 190 : shade;
    image[offset + 1] = excluded ? 132 : shade;
    image[offset + 2] = excluded ? 54 : shade;
  }
}
const validation = validateCriticalPaths(metadata, { nowMs: () => 0 });
if (validation.errors.length || validation.warnings.length) throw new Error("critical path validation failed");
await mkdir(outDir, { recursive: true });
await sharp(image, { raw: { width: 256, height: 256, channels: 3 } }).png().toFile(pngPath);
const stats = {
  ready: true,
  featureStampHash: features.hash,
  hillCenterBeforeM: baseHeight(128, 128),
  roadCenterAfterM: tile.heights[128 * tile.res + 128],
  excludedScatterSamples: excludedSamples,
  structureCoverageAtRoad: features.sampleStructureCoverage(128, 128, 8),
  criticalPathErrors: validation.errors.length,
  criticalPathWarnings: validation.warnings.length,
};
await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
console.log(`[phase6-road-stamp] wrote ${path.relative(process.cwd(), pngPath)}`);
console.log(`[phase6-road-stamp] wrote ${path.relative(process.cwd(), statsPath)}`);
console.log(JSON.stringify(stats));
