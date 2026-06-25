import type { PageMesh } from "../types.js";

export const PAGE_SOURCE_SECTION_KINDS = [
  "mainTerrain",
  "waterSurface",
  "deepOcean",
  "surfFoam",
  "debugOverlay",
  "prop",
  "collider",
  "skirt",
  "apron",
  "stitchFallback",
] as const;

export type PageSourceSectionKind = typeof PAGE_SOURCE_SECTION_KINDS[number];

export type MainTerrainClass =
  | "inland"
  | "beach"
  | "cliff"
  | "cove"
  | "reef";

export interface PageSourceSection {
  kind: PageSourceSectionKind;
  mesh: PageMesh;
  terrainClass?: MainTerrainClass;
  /** Page sources must use original extraction positions, never runtime morph output. */
  positionSource: "extracted" | "morphDeformed";
  label?: string;
}

export interface PageSourceSectionDecision {
  section: PageSourceSection;
  included: boolean;
  reason: string;
}

export const PAGE_SOURCE_DEBUG_COLORS: Record<PageSourceSectionKind, [number, number, number]> = {
  mainTerrain: [0.2, 0.85, 0.3],
  waterSurface: [0.1, 0.45, 1],
  deepOcean: [0.02, 0.15, 0.5],
  surfFoam: [1, 1, 1],
  debugOverlay: [1, 0, 1],
  prop: [0.95, 0.65, 0.1],
  collider: [1, 0.15, 0.15],
  skirt: [0.55, 0.15, 0.75],
  apron: [0.7, 0.35, 0.15],
  stitchFallback: [1, 0.45, 0],
};

export function pageSourceSectionDecision(
  section: PageSourceSection,
): PageSourceSectionDecision {
  if (section.positionSource !== "extracted") {
    return {
      section,
      included: false,
      reason: "morph-deformed positions are runtime output, not page source",
    };
  }
  if (section.kind !== "mainTerrain") {
    return {
      section,
      included: false,
      reason: `${section.kind} is not main terrain surface`,
    };
  }
  if (!section.terrainClass) {
    return {
      section,
      included: false,
      reason: "main terrain section is missing terrainClass",
    };
  }
  return {
    section,
    included: true,
    reason: `included main terrain: ${section.terrainClass}`,
  };
}

export function pageSourceSectionDebugColors(
  sections: readonly PageSourceSection[],
): Float32Array[] {
  return sections.map((section) => {
    const vertexCount = section.mesh.positions.length / 3;
    const color = PAGE_SOURCE_DEBUG_COLORS[section.kind];
    const colors = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      colors.set(color, vertex * 3);
    }
    return colors;
  });
}
