import type { BgName, IconPalette, PaletteName } from "./types";

export const PALETTES = {
  grass: { base: "#4fa647", light: "#b9ef8a", dark: "#23572b", glow: "#9fe070", accent: "#102d16" },
  earth: { base: "#9a6a3e", light: "#d8ab72", dark: "#50301d", glow: "#d89a50", accent: "#24140c" },
  rock: { base: "#89939a", light: "#d7e0e5", dark: "#3d474f", glow: "#cfe4ff", accent: "#1d252b" },
  sand: { base: "#d6b66c", light: "#fff0b4", dark: "#78602d", glow: "#ffe7a0", accent: "#3c3013" },
  snow: { base: "#dcebf2", light: "#ffffff", dark: "#7f9cac", glow: "#edfaff", accent: "#405461" },
  water: { base: "#4aa4d8", light: "#bceaff", dark: "#1f507e", glow: "#8fe0ff", accent: "#0d2a45" },
  steel: { base: "#aebdc8", light: "#eef4f8", dark: "#4e5a66", glow: "#cfe4ff", accent: "#2b333c" },
  gold: { base: "#e8b33a", light: "#ffe9a8", dark: "#8a5f12", glow: "#ffd97a", accent: "#5c3e08" },
  warning: { base: "#d74c35", light: "#ffb29b", dark: "#721b14", glow: "#ff704f", accent: "#330906" },
  debug: { base: "#56d0cf", light: "#c8ffff", dark: "#1e6b72", glow: "#8affff", accent: "#0b3034" },
  paint: { base: "#c66ee8", light: "#f0c8ff", dark: "#5e2a78", glow: "#e0a0ff", accent: "#2a0e38" },
  camera: { base: "#77a9ff", light: "#d8e9ff", dark: "#2b5ba0", glow: "#a0d4ff", accent: "#102b54" },
  paper: { base: "#e7d2a0", light: "#fff3c9", dark: "#8f6c35", glow: "#fff0b0", accent: "#463016" },
} satisfies Record<PaletteName, IconPalette>;

export const BACKGROUNDS = {
  terrain: ["#b9ef8a", "#347a35", "#0d2412"],
  earth: ["#d8a868", "#74481e", "#20120a"],
  rock: ["#c8d4dc", "#5a6878", "#181d24"],
  sand: ["#ffe6a0", "#a88330", "#30240a"],
  snow: ["#ffffff", "#7898ad", "#162834"],
  water: ["#a8e8ff", "#2a6890", "#0a2030"],
  texture: ["#d6c1a0", "#6a5842", "#1d1813"],
  tool: ["#c8d4dc", "#5a6878", "#181d24"],
  lod: ["#a8c8e8", "#3a5a80", "#101c2c"],
  debug: ["#94fff1", "#247c84", "#08292f"],
  camera: ["#bddcff", "#315d9a", "#101d33"],
  project: ["#f0e0b0", "#907040", "#2a200c"],
  system: ["#c8d4dc", "#4d5b63", "#141a1e"],
  danger: ["#ff9a74", "#a02818", "#2e0a06"],
  fallback: ["#a8a8a0", "#4e4e48", "#141412"],
} satisfies Record<BgName, [string, string, string]>;
