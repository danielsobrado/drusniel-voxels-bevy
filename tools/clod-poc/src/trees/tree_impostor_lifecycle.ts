import type { TreeSettings } from "./tree_config.js";

export interface TreeImpostorBakeCommitInput {
  signal: AbortSignal;
  activeController: AbortController | null;
  controller: AbortController;
  expectedContentKey: string;
  currentContentKey: string;
}

export function treeImpostorBakeContentKey(
  settings: TreeSettings,
  geometryKey: string,
): string {
  const impostors = settings.impostors;
  return JSON.stringify({
    geometry: geometryKey,
    species: settings.species,
    foliage: settings.foliage,
    impostors: {
      sourceLod: impostors.sourceLod,
      bakeAgeLayers: impostors.bakeAgeLayers,
      resolutionPx: impostors.resolutionPx,
      octahedralGridSize: impostors.octahedralGridSize,
      atlasPaddingPx: impostors.atlasPaddingPx,
    },
  });
}

export function treeImpostorBakeCanCommit(input: TreeImpostorBakeCommitInput): boolean {
  return !input.signal.aborted
    && input.activeController === input.controller
    && input.expectedContentKey === input.currentContentKey;
}
