import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, "../src/trees/tree_config.ts");
const splitConfigPaths = [
  resolve(here, "../src/trees/tree_config_types.ts"),
  resolve(here, "../src/trees/tree_config_defaults.ts"),
  resolve(here, "../src/trees/tree_config_parsing.ts"),
];

const edits = [
  {
    label: "expanded species import",
    expected: `import { load } from "js-yaml";`,
    replacement: `import { load } from "js-yaml";\nimport {\n  TREE_EXPANDED_SPECIES,\n  TREE_EXPANDED_SPECIES_DEFAULTS,\n  TREE_EXPANDED_SPECIES_NICHES,\n  type TreeExpandedSpeciesId,\n} from "./tree_species_expansion.js";`,
  },
  {
    label: "species id type",
    expected: `export type TreeSpeciesId = "oak" | "pine" | "dead";`,
    replacement: `export type TreeSpeciesId = TreeExpandedSpeciesId;`,
  },
  {
    label: "species array",
    expected: `export const TREE_SPECIES: readonly TreeSpeciesId[] = ["oak", "pine", "dead"] as const;`,
    replacement: `export const TREE_SPECIES: readonly TreeSpeciesId[] = TREE_EXPANDED_SPECIES;`,
  },
  {
    label: "default ecology species zones",
    expected: `  speciesZones: {\n    oak: { heightPreference: "low", moisturePreference: 0.65, slopeTolerance: 0.55, clusterBias: 0.75, oldForestBias: 0 },\n    pine: { heightPreference: "high", moisturePreference: 0.35, slopeTolerance: 0.85, clusterBias: 0.9, oldForestBias: 0 },\n    dead: { heightPreference: "any", moisturePreference: 0.45, slopeTolerance: 0.75, clusterBias: 1.0, oldForestBias: 0.85 },\n  },`,
    replacement: `  speciesZones: speciesZonesFromExpandedDefaults(),`,
  },
  {
    label: "default species map",
    expectedStart: `  species: {\n    oak: {`,
    expectedEnd: `  },\n  render: { debugColorByLod: false },`,
    replacement: `  species: cloneSpeciesSettingsMap(TREE_EXPANDED_SPECIES_DEFAULTS),\n  render: { debugColorByLod: false },`,
  },
  {
    label: "clone species map",
    expected: `    species: {\n      oak: cloneSpecies(settings.species.oak),\n      pine: cloneSpecies(settings.species.pine),\n      dead: cloneSpecies(settings.species.dead),\n    },`,
    replacement: `    species: cloneSpeciesSettingsMap(settings.species),`,
  },
  {
    label: "parse species map",
    expected: `    species: {\n      oak: readSpecies(fallback.species.oak, raw.species?.oak),\n      pine: readSpecies(fallback.species.pine, raw.species?.pine),\n      dead: readSpecies(fallback.species.dead, raw.species?.dead),\n    },`,
    replacement: `    species: readSpeciesSettingsMap(fallback.species, raw.species),`,
  },
  {
    label: "clone ecology species zones",
    expected: `    speciesZones: {\n      oak: { ...ecology.speciesZones.oak },\n      pine: { ...ecology.speciesZones.pine },\n      dead: { ...ecology.speciesZones.dead },\n    },`,
    replacement: `    speciesZones: cloneSpeciesZoneMap(ecology.speciesZones),`,
  },
  {
    label: "read ecology species zones",
    expected: `    speciesZones: {\n      oak: readSpeciesZone(fallback.speciesZones.oak, raw?.species_zones?.oak),\n      pine: readSpeciesZone(fallback.speciesZones.pine, raw?.species_zones?.pine),\n      dead: readSpeciesZone(fallback.speciesZones.dead, raw?.species_zones?.dead),\n    },`,
    replacement: `    speciesZones: readSpeciesZoneMap(fallback.speciesZones, raw?.species_zones),`,
  },
  {
    label: "species map helper functions",
    expected: `function cloneSpecies(species: TreeSpeciesSettings): TreeSpeciesSettings {\n  return { ...species, morphology: { ...species.morphology } };\n}\n`,
    replacement: `function cloneSpecies(species: TreeSpeciesSettings): TreeSpeciesSettings {\n  return { ...species, morphology: { ...species.morphology } };\n}\n\nfunction cloneSpeciesSettingsMap(source: Record<TreeSpeciesId, TreeSpeciesSettings>): Record<TreeSpeciesId, TreeSpeciesSettings> {\n  return Object.fromEntries(TREE_SPECIES.map((species) => [species, cloneSpecies(source[species])])) as Record<TreeSpeciesId, TreeSpeciesSettings>;\n}\n\nfunction readSpeciesSettingsMap(\n  fallback: Record<TreeSpeciesId, TreeSpeciesSettings>,\n  raw: Partial<Record<TreeSpeciesId, TreeYamlSpecies>> | undefined,\n): Record<TreeSpeciesId, TreeSpeciesSettings> {\n  return Object.fromEntries(TREE_SPECIES.map((species) => [species, readSpecies(fallback[species], raw?.[species])])) as Record<TreeSpeciesId, TreeSpeciesSettings>;\n}\n\nfunction speciesZonesFromExpandedDefaults(): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {\n  return Object.fromEntries(TREE_SPECIES.map((species) => {\n    const niche = TREE_EXPANDED_SPECIES_NICHES[species];\n    return [species, {\n      heightPreference: niche.heightPreference,\n      moisturePreference: niche.moisturePreference,\n      slopeTolerance: niche.slopeTolerance,\n      clusterBias: niche.clusterBias,\n      oldForestBias: niche.oldForestBias,\n    }];\n  })) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;\n}\n\nfunction cloneSpeciesZoneMap(source: Record<TreeSpeciesId, TreeSpeciesZoneSettings>): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {\n  return Object.fromEntries(TREE_SPECIES.map((species) => [species, { ...source[species] }])) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;\n}\n\nfunction readSpeciesZoneMap(\n  fallback: Record<TreeSpeciesId, TreeSpeciesZoneSettings>,\n  raw: Partial<Record<TreeSpeciesId, Partial<{\n    height_preference: unknown;\n    moisture_preference: number;\n    slope_tolerance: number;\n    cluster_bias: number;\n    old_forest_bias: number;\n  }>>> | undefined,\n): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {\n  return Object.fromEntries(TREE_SPECIES.map((species) => [species, readSpeciesZone(fallback[species], raw?.[species])])) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;\n}\n`,
  },
];

export function wireTreeConfigTree9Source(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let source = input.replace(/\r\n/g, "\n");
  if (isCurrentSixSpeciesConfig(source)) {
    return { source: eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source, changed: false, applied: [], skipped: edits.map((edit) => edit.label) };
  }
  let changed = false;
  const applied = [];
  const skipped = [];

  for (const item of edits) {
    const result = applyEdit(source, item);
    source = result.source;
    changed ||= result.changed;
    if (result.changed) applied.push(item.label);
    else skipped.push(item.label);
  }

  return { source: eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source, changed, applied, skipped };
}

export function wireTreeConfigTree9File(path = defaultPath, options = {}) {
  const input = readTreeConfigInput(path);
  const result = wireTreeConfigTree9Source(input.source);
  if (!options.dryRun && result.changed) {
    if (!input.writePath) throw new Error("Cannot rewrite split tree config sources with the legacy monolithic patcher.");
    writeFileSync(input.writePath, result.source, "utf8");
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeConfigTree9File(defaultPath, { dryRun });
  console.log(`${dryRun ? "Checked" : "Updated"} ${defaultPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function applyEdit(source, edit) {
  if (edit.expectedStart) return applyRangeEdit(source, edit);
  const expectedCount = countOccurrences(source, edit.expected);
  const replacementCount = countOccurrences(source, edit.replacement);
  if (replacementCount === 1) return { source, changed: false };
  if (replacementCount > 1 || expectedCount !== 1) {
    throw new Error(`Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`);
  }
  return { source: source.replace(edit.expected, edit.replacement), changed: true };
}

function applyRangeEdit(source, edit) {
  const replacementCount = countOccurrences(source, edit.replacement);
  if (replacementCount === 1) return { source, changed: false };
  if (replacementCount > 1) throw new Error(`Cannot apply ${edit.label}: replacement already appears ${replacementCount} times.`);
  const start = source.indexOf(edit.expectedStart);
  if (start < 0) throw new Error(`Cannot apply ${edit.label}: start anchor not found.`);
  const end = source.indexOf(edit.expectedEnd, start);
  if (end < 0) throw new Error(`Cannot apply ${edit.label}: end anchor not found.`);
  return { source: `${source.slice(0, start)}${edit.replacement}${source.slice(end + edit.expectedEnd.length)}`, changed: true };
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function isCurrentSixSpeciesConfig(source) {
  return [
    `export const TREE_SPECIES = ["oak", "pine", "dead", "birch", "willow", "spruce"] as const;`,
    "export interface TreeSpeciesMorphologySettings",
    "export interface TreeSpeciesZoneSettings",
    "spruce: species(0.10, 16, 60, 10.0, 0.32, 3.4",
    "for (const id of TREE_SPECIES) species[id] = parseSpeciesSettings(root[id], fallback.species[id]);",
    "for (const id of TREE_SPECIES) speciesZones[id] = parseSpeciesZone(root[id], fallback.ecology.speciesZones[id]);",
  ].every((marker) => source.includes(marker));
}

function readTreeConfigInput(path) {
  const source = readFileSync(path, "utf8");
  if (resolve(path) === defaultPath && isTreeConfigBarrel(source) && splitConfigPaths.every((candidate) => existsSync(candidate))) {
    return {
      source: splitConfigPaths.map((candidate) => readFileSync(candidate, "utf8")).join("\n"),
      writePath: null,
    };
  }
  return { source, writePath: path };
}

function isTreeConfigBarrel(source) {
  const normalized = source.replace(/\r\n/g, "\n").trim();
  return [
    `export * from "./tree_config_types.js";`,
    `export * from "./tree_config_defaults.js";`,
    `export * from "./tree_config_parsing.js";`,
  ].every((line) => normalized.includes(line));
}
