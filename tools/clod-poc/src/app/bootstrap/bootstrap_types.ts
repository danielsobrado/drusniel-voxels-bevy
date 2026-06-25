import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { TerrainMaterialHandle } from "../../rendering/terrain_material.js";
import { computeGeometryNormals } from "../../terrain/geometry/page_geometry.js";

export interface NodeView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  mat: TerrainMaterialHandle;
  sourceNormals: Float32Array;
  recomputedNormals: Float32Array | null;
  selected: boolean;
  fade: number;
  target: number;
}

export function recomputedNormalsFor(view: NodeView): Float32Array {
  if (!view.recomputedNormals) view.recomputedNormals = computeGeometryNormals(view.node.mesh);
  return view.recomputedNormals;
}
