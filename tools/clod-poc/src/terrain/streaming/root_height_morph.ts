import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";

export const ROOT_HEIGHT_MORPH_ATTRIBUTE = "rootMorphDeltaY";
export const ROOT_HEIGHT_MORPH_ENABLED = false;

export interface RootHeightMorphView {
  node: Pick<ClodPageNode, "id" | "revision" | "mesh" | "gpuResidentOnly" | "rootTransition">;
  mesh: THREE.Mesh;
}

export interface RootHeightMorphStats {
  builtRoots: number;
  builtVertices: number;
  buildMs: number;
}

const EMPTY_STATS: RootHeightMorphStats = {
  builtRoots: 0,
  builtVertices: 0,
  buildMs: 0,
};

/**
 * Root height morphing is intentionally disabled. Streamed roots keep their authored
 * geometry and use the existing dithered crossfade for topology-changing transitions.
 */
export function applyRootHeightMorph(
  view: RootHeightMorphView,
  _sourceViews: readonly RootHeightMorphView[],
): RootHeightMorphStats {
  resetRootHeightMorph(view);
  return EMPTY_STATS;
}

export function resetRootHeightMorph(view: RootHeightMorphView): void {
  if (view.node.rootTransition) view.node.rootTransition.parentHeightMorphReady = false;
  if (view.node.gpuResidentOnly) return;

  const geometry = view.mesh.geometry as THREE.BufferGeometry;
  const attribute = geometry.getAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  if (!attribute) return;

  const values = attribute.array as Float32Array;
  let dirty = false;
  for (let index = 0; index < values.length; index++) {
    if (values[index] === 0) continue;
    values[index] = 0;
    dirty = true;
  }
  if (dirty) attribute.needsUpdate = true;
}
