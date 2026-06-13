import type { BgName, ClodIconKind, FxName, IconRecipe, PaletteName, PrimitiveName, PrimitivePlacement } from "./types";

const TR = { x: 13, y: -13, s: 0.45 } as const;
const BR = { x: 13, y: 13, s: 0.45 } as const;
const BIG = { s: 1.15, alpha: 0.35 } as const;

function r(
  bg: BgName,
  pal: PaletteName,
  prims: (PrimitiveName | PrimitivePlacement)[],
  fx?: FxName[],
): IconRecipe {
  return { bg, pal, prims: prims.map((p) => (typeof p === "string" ? { p } : p)), fx };
}

export const FALLBACK_RECIPE = r("fallback", "steel", ["sigil"]);

export const ICON_RECIPES: Record<ClodIconKind, Record<string, IconRecipe>> = {
  terrain: {
    grass: r("terrain", "grass", ["terrainTile", "grassTuft"], ["glow"]),
    earth: r("earth", "earth", ["terrainTile"]),
    rock: r("rock", "rock", ["terrainTile", { p: "stone", ...BR, pal: "rock" }], ["crack"]),
    sand: r("sand", "sand", ["terrainTile"]),
    snow: r("snow", "snow", ["terrainTile", { p: "sigil", ...TR, pal: "snow" }], ["sparkle"]),
    water: r("water", "water", ["waves"], ["glow"]),
  },
  texture: {
    load: r("texture", "paper", ["page", { p: "importArrow", ...BR, pal: "gold" }], ["sparkle"]),
    slot: r("texture", "steel", ["slot"]),
  },
  tool: {
    dig: r("tool", "steel", ["shovel"], ["motion"]),
    raise: r("tool", "gold", ["arrowUp"]),
    lower: r("tool", "steel", ["arrowDown"]),
    smooth: r("tool", "water", ["smooth"], ["glow"]),
    paint: r("tool", "paint", ["brush"], ["sparkle"]),
  },
  lod: {
    page: r("lod", "paper", [{ p: "grid", ...BIG, pal: "camera" }, "page"]),
    lod0: r("lod", "gold", ["lodBadge"], ["glow"]),
    lod1: r("lod", "steel", ["lodBadge"]),
    lod2: r("lod", "water", ["lodBadge"]),
    lod3: r("lod", "rock", ["lodBadge"]),
    "locked-border": r("lod", "gold", ["grid", { p: "lock", ...BR, pal: "gold" }]),
    error: r("danger", "warning", ["warning"], ["glow", "crack"]),
  },
  debug: {
    wireframe: r("debug", "debug", ["wireframe"], ["glow"]),
    "page-boundary": r("debug", "debug", ["boundary"]),
    "seam-points": r("debug", "debug", ["points"], ["sparkle"]),
    "normal-colors": r("debug", "paint", ["normalFan"], ["glow"]),
  },
  camera: {
    orbit: r("camera", "camera", ["orbit"], ["motion"]),
    player: r("camera", "camera", ["player"], ["glow"]),
  },
  project: {
    import: r("project", "paper", ["page", { p: "importArrow", ...BR, pal: "gold" }]),
    export: r("project", "paper", ["page", { p: "exportArrow", ...BR, pal: "gold" }]),
  },
  system: {
    rebuild: r("system", "steel", ["rebuild"], ["motion"]),
    warning: r("danger", "warning", ["warning"], ["glow"]),
  },
};
