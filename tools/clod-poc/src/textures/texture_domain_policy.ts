export type TextureDomain =
  | "terrain-common"
  | "terrain-biome-window"
  | "construction"
  | "character"
  | "decals"
  | "ui";

export type TextureEvictionPolicy = "never" | "active-window" | "lru-visible" | "lru-distance" | "lru-use";

export interface TextureDomainBudget {
  domain: TextureDomain;
  alwaysLoadedSets: number;
  maxResidentSets: number;
  eviction: TextureEvictionPolicy;
  notes: string;
}

export const TEXTURE_DOMAIN_BUDGETS: Record<TextureDomain, TextureDomainBudget> = {
  "terrain-common": {
    domain: "terrain-common",
    alwaysLoadedSets: 8,
    maxResidentSets: 8,
    eviction: "never",
    notes: "Common terrain layers shared by every biome: grass, rock, sand, snow, dirt, moss, gravel, wet soil.",
  },
  "terrain-biome-window": {
    domain: "terrain-biome-window",
    alwaysLoadedSets: 0,
    maxResidentSets: 2,
    eviction: "active-window",
    notes: "Only current biome plus adjacent/target biome may have authored terrain PBR layers resident.",
  },
  construction: {
    domain: "construction",
    alwaysLoadedSets: 6,
    maxResidentSets: 12,
    eviction: "lru-use",
    notes: "Reusable trim sheets and material atlases for wood, stone, thatch, clay/plaster, metal, and glass.",
  },
  character: {
    domain: "character",
    alwaysLoadedSets: 4,
    maxResidentSets: 16,
    eviction: "lru-distance",
    notes: "Shared skin, hair, cloth, leather/armor sets; visible NPC outfits are streamed by distance.",
  },
  decals: {
    domain: "decals",
    alwaysLoadedSets: 2,
    maxResidentSets: 8,
    eviction: "lru-visible",
    notes: "Damage, dirt, moss, wetness, burn marks, and construction wear overlays.",
  },
  ui: {
    domain: "ui",
    alwaysLoadedSets: 1,
    maxResidentSets: 4,
    eviction: "lru-use",
    notes: "Inventory and editor previews. Never shares GPU arrays with world materials.",
  },
};

export function totalResidentTextureSetBudget(): number {
  return Object.values(TEXTURE_DOMAIN_BUDGETS)
    .reduce((sum, budget) => sum + budget.maxResidentSets, 0);
}

export function getTextureDomainBudget(domain: TextureDomain): TextureDomainBudget {
  return TEXTURE_DOMAIN_BUDGETS[domain];
}
