export type ClodIconKind =
  | "terrain"
  | "texture"
  | "tool"
  | "lod"
  | "debug"
  | "camera"
  | "project"
  | "system";

export type Ctx = CanvasRenderingContext2D;

export interface IconPalette {
  base: string;
  light: string;
  dark: string;
  glow: string;
  accent: string;
}

export type PaletteName =
  | "grass"
  | "earth"
  | "rock"
  | "sand"
  | "snow"
  | "water"
  | "steel"
  | "gold"
  | "warning"
  | "debug"
  | "paint"
  | "camera"
  | "paper";

export type BgName =
  | "terrain"
  | "earth"
  | "rock"
  | "sand"
  | "snow"
  | "water"
  | "texture"
  | "tool"
  | "lod"
  | "debug"
  | "camera"
  | "project"
  | "system"
  | "danger"
  | "fallback";

export type PrimitiveName =
  | "terrainTile"
  | "grassTuft"
  | "stone"
  | "waves"
  | "page"
  | "slot"
  | "shovel"
  | "arrowUp"
  | "arrowDown"
  | "smooth"
  | "brush"
  | "grid"
  | "lodBadge"
  | "lock"
  | "warning"
  | "wireframe"
  | "boundary"
  | "points"
  | "normalFan"
  | "orbit"
  | "player"
  | "importArrow"
  | "exportArrow"
  | "rebuild"
  | "sigil";

export type FxName = "glow" | "sparkle" | "crack" | "motion";

export interface PrimitivePlacement {
  p: PrimitiveName;
  x?: number;
  y?: number;
  s?: number;
  rot?: number;
  pal?: PaletteName;
  alpha?: number;
}

export interface IconRecipe {
  bg: BgName;
  pal: PaletteName;
  prims: PrimitivePlacement[];
  fx?: FxName[];
}
