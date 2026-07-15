export const DRESSING_CLASSES = [
  "dead_log_fresh",
  "dead_log_mossy",
  "dead_log_rotten",
  "stump_fresh",
  "stump_rotten",
  "broken_snag",
  "large_driftwood",
  "large_talus_boulder",
  "shelf_fungus",
  "cap_fungus",
  "trunk_moss",
  "trunk_lichen",
  "root_moss",
  "hanging_vine",
  "root_fern",
  "moss_patch",
  "lichen_patch",
  "leaf_litter",
  "needle_litter",
  "twig_cluster",
  "bark_chip_cluster",
  "small_talus",
  "river_cobbles",
  "wet_stone_cluster",
  "small_driftwood",
  "bank_fern",
  "cave_mouth_fern",
  "cliff_fern",
  "flower_patch",
] as const;

export type DressingClassId = typeof DRESSING_CLASSES[number];
export type DressingOwnership = "persistent" | "parent_attached" | "terrain_attached";
export type DressingCavePolicy = "reject" | "mouth_only" | "allow_floor" | "allow_wall";

export interface DressingClassDefinition {
  readonly id: DressingClassId;
  readonly ownership: DressingOwnership;
  readonly geometryFamily: string;
  readonly materialFamily: string;
  readonly placementStage: number;
  readonly spacingM: number;
  readonly maximumPerCluster: number;
  readonly lodDistancesM: readonly [number, number, number];
  readonly castsNearShadow: boolean;
  readonly castsProxyShadow: boolean;
  readonly cavePolicy: DressingCavePolicy;
  readonly attachmentPolicy: string;
}

type DefinitionBody = Omit<DressingClassDefinition, "id">;

const PERSISTENT_LOD = [45, 180, 700] as const;
const ATTACHED_LOD = [25, 90, 260] as const;
const TERRAIN_LOD = [20, 70, 220] as const;

function persistent(
  geometryFamily: string,
  materialFamily: string,
  spacingM: number,
  attachmentPolicy = "terrain_supported",
): DefinitionBody {
  return {
    ownership: "persistent",
    geometryFamily,
    materialFamily,
    placementStage: 2,
    spacingM,
    maximumPerCluster: 8,
    lodDistancesM: PERSISTENT_LOD,
    castsNearShadow: true,
    castsProxyShadow: true,
    cavePolicy: "reject",
    attachmentPolicy,
  };
}

function attached(
  geometryFamily: string,
  materialFamily: string,
  attachmentPolicy: string,
): DefinitionBody {
  return {
    ownership: "parent_attached",
    geometryFamily,
    materialFamily,
    placementStage: 4,
    spacingM: 0,
    maximumPerCluster: 24,
    lodDistancesM: ATTACHED_LOD,
    castsNearShadow: false,
    castsProxyShadow: false,
    cavePolicy: "reject",
    attachmentPolicy,
  };
}

function terrain(
  geometryFamily: string,
  materialFamily: string,
  placementStage: 5 | 6,
  spacingM: number,
  cavePolicy: DressingCavePolicy = "reject",
  attachmentPolicy = "terrain_surface",
): DefinitionBody {
  return {
    ownership: "terrain_attached",
    geometryFamily,
    materialFamily,
    placementStage,
    spacingM,
    maximumPerCluster: placementStage === 5 ? 48 : 96,
    lodDistancesM: TERRAIN_LOD,
    castsNearShadow: false,
    castsProxyShadow: false,
    cavePolicy,
    attachmentPolicy,
  };
}

const DEFINITION_BODIES: readonly DefinitionBody[] = [
  persistent("dead_log", "wood_decay", 18),
  persistent("dead_log", "wood_decay", 18),
  persistent("dead_log", "wood_decay", 18),
  persistent("stump", "wood_decay", 22, "paired_dead_tree_origin"),
  persistent("stump", "wood_decay", 22, "paired_dead_tree_origin"),
  persistent("broken_snag", "wood_decay", 30, "tree_structure"),
  persistent("driftwood", "wood_decay", 48, "shore_supported"),
  persistent("small_talus", "river_cobble", 28, "terrain_supported"),
  attached("fungus_shelf", "fungus", "log_top|log_side|stump_side|trunk_low|trunk_mid"),
  attached("fungus_cap", "fungus", "terrain_near_rotten_wood"),
  attached("moss_patch", "moss", "trunk_low|trunk_mid"),
  attached("lichen_patch", "lichen", "trunk_low|trunk_mid|trunk_high"),
  attached("moss_patch", "moss", "root_flare"),
  attached("vine", "vine", "trunk_mid|trunk_high|branch_dead"),
  attached("fern_bank", "fern", "root_flare"),
  terrain("moss_patch", "moss", 6, 3.5, "allow_floor"),
  terrain("lichen_patch", "lichen", 6, 5),
  terrain("litter_leaf", "litter", 6, 2.2),
  terrain("litter_needle", "litter", 6, 2.2),
  terrain("twig_cluster", "litter", 6, 4),
  terrain("bark_chip_cluster", "litter", 6, 5),
  terrain("small_talus", "river_cobble", 5, 4),
  terrain("river_cobble", "river_cobble", 5, 3),
  terrain("wet_stone", "wet_stone", 5, 3.5, "allow_floor"),
  terrain("driftwood", "wood_decay", 5, 20),
  terrain("fern_bank", "fern", 5, 3),
  terrain("fern_cave", "fern", 5, 3, "mouth_only"),
  terrain("fern_cliff", "fern", 5, 3.5, "allow_wall", "exact_supported_surface"),
  terrain("flower_patch", "flower_patch", 6, 4),
];

if (DEFINITION_BODIES.length !== DRESSING_CLASSES.length) {
  throw new Error("dressing class registry definition count mismatch");
}

export const DRESSING_CLASS_DEFINITIONS = Object.freeze(Object.fromEntries(
  DRESSING_CLASSES.map((id, index) => [id, Object.freeze({ id, ...DEFINITION_BODIES[index] })]),
)) as Readonly<Record<DressingClassId, DressingClassDefinition>>;

export type PersistentDressingClassId =
  | "dead_log_fresh"
  | "dead_log_mossy"
  | "dead_log_rotten"
  | "stump_fresh"
  | "stump_rotten"
  | "broken_snag"
  | "large_driftwood"
  | "large_talus_boulder";

export function isDressingClassId(value: unknown): value is DressingClassId {
  return typeof value === "string" && DRESSING_CLASSES.includes(value as DressingClassId);
}

export function requireDressingClass(value: unknown): DressingClassDefinition {
  if (!isDressingClassId(value)) throw new Error(`unknown dressing class: ${String(value)}`);
  return DRESSING_CLASS_DEFINITIONS[value];
}

export function dressingClassNumericId(value: DressingClassId): number {
  const index = DRESSING_CLASSES.indexOf(value);
  if (index < 0) throw new Error(`unknown dressing class: ${String(value)}`);
  return index + 1;
}

export function isPersistentDressingClass(value: DressingClassId): value is PersistentDressingClassId {
  return requireDressingClass(value).ownership === "persistent";
}
