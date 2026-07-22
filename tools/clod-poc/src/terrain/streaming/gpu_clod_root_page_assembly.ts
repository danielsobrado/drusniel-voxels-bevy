import type { ClodPagesConfig } from "../../config.js";
import { simplifyPage } from "../../clod/simplify.js";
import { concatPageSourceMeshes, filterPageSourceSections } from "../../clod/pageSource.js";
import type { PageSourceSection } from "../../clod/pageSourceSections.js";
import { weldVertices } from "../../clod/weld.js";
import {
  stripDegenerateTriangles,
  validateFinalPageMesh,
  validatePageMesh,
  validateWeldedIntermediate,
} from "../../clod/validate.js";
import {
  boundsOf,
  clonePageMesh,
  footprintFor,
  INITIAL_NODE_REVISION,
  requireFourChildren,
} from "../../clod/quadtree_support.js";
import { selectParentSimplificationCandidate } from "../../clod/quadtree.js";
import { buildParentSimplifyLocks } from "../../lock.js";
import type { ClodPageNode, PageMesh } from "../../types.js";

const DEFAULT_MATERIAL_WEIGHT_STRIDE = 4;

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  materials: Float32Array;
  materialWeights?: Float32Array;
  materialWeightStride?: number;
  indices: Uint32Array;
}

export function buildLod0Page(px: number, pz: number, chunkMeshes: readonly PageMesh[], cfg: ClodPagesConfig): ClodPageNode {
  const mesh = weldChunkMeshes(chunkMeshes, cfg);
  const footprint = footprintFor(0, px, pz, cfg);
  const nodeId = `L0:${px},${pz}`;
  validatePageMesh(mesh, footprint, cfg.validation.zero_area_epsilon, nodeId);
  return {
    id: nodeId,
    revision: INITIAL_NODE_REVISION,
    level: 0,
    children: [],
    mesh,
    footprint,
    bounds: boundsOf(mesh),
    errorWorld: 0,
    lowBenefit: false,
    chunkMeshes: [...chunkMeshes],
  };
}

export function chunkMeshToPageMesh(mesh: ChunkMesh): PageMesh {
  const vertexTotal = mesh.positions.length / 3;
  const materialWeightStride = mesh.materialWeightStride ?? DEFAULT_MATERIAL_WEIGHT_STRIDE;
  const materialWeights = mesh.materialWeights?.length === vertexTotal * materialWeightStride
    ? mesh.materialWeights
    : oneHotMaterialWeights(mesh.materials, vertexTotal, materialWeightStride);
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    paintSlots: mesh.materials.length === vertexTotal ? mesh.materials : new Float32Array(vertexTotal),
    materialWeights,
    materialWeightStride,
    indices: mesh.indices,
  };
}

function oneHotMaterialWeights(materials: Float32Array, vertexTotal: number, stride: number): Float32Array {
  const weights = new Float32Array(vertexTotal * stride);
  for (let vertex = 0; vertex < vertexTotal; vertex++) {
    weights[vertex * stride + Math.max(0, Math.min(stride - 1, Math.floor(materials[vertex] ?? 0)))] = 1;
  }
  return weights;
}

function weldChunkMeshes(chunks: readonly PageMesh[], cfg: ClodPagesConfig): PageMesh {
  const sections: PageSourceSection[] = chunks.map((mesh, index) => ({
    kind: "mainTerrain",
    terrainClass: "inland",
    positionSource: "extracted",
    label: `gpu-chunk-${index}`,
    mesh,
  }));
  const filtered = filterPageSourceSections(sections);
  return weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  }).mesh;
}

export function buildParentNode(level: number, nx: number, nz: number, children: readonly ClodPageNode[], cfg: ClodPagesConfig): ClodPageNode {
  requireFourChildren(level, nx, nz, children);
  const merged = concatPageSourceMeshes(children.map((child) => child.mesh));
  const { mesh: welded } = weldVertices(merged, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  const footprint = footprintFor(level, nx, nz, cfg);
  validateWeldedIntermediate(welded, `L${level}:${nx},${nz} gpu welded`, cfg.validation.zero_area_epsilon);
  const locks = buildParentSimplifyLocks(welded);
  const label = `L${level}:${nx},${nz}`;
  const selected = selectParentSimplificationCandidate(
    simplifyPage(clonePageMesh(welded), locks, cfg),
    welded,
    footprint,
    cfg.validation.zero_area_epsilon,
    `${label} gpu`,
  );
  stripDegenerateTriangles(selected.mesh, cfg.validation.zero_area_epsilon);
  try {
    validateFinalPageMesh(selected.mesh, footprint, cfg.validation.zero_area_epsilon, `${label} gpu final`);
    return {
      id: `${label}`,
      revision: INITIAL_NODE_REVISION,
      level,
      children: [...children],
      mesh: selected.mesh,
      footprint,
      bounds: boundsOf(selected.mesh),
      errorWorld: selected.errorWorld + Math.max(...children.map((child) => child.errorWorld)),
      lowBenefit: selected.lowBenefit,
    };
  } catch {
    // Last resort: keep the pre-simplify welded parent when near-edge open borders survive
    // simplify. Prefer a coarser valid parent over failing the whole GPU batch into worker
    // fallback (which trips the zero-fallback acceptance gate).
    stripDegenerateTriangles(welded, cfg.validation.zero_area_epsilon);
    validateFinalPageMesh(welded, footprint, cfg.validation.zero_area_epsilon, `${label} gpu welded last-resort`);
    return {
      id: `${label}`,
      revision: INITIAL_NODE_REVISION,
      level,
      children: [...children],
      mesh: welded,
      footprint,
      bounds: boundsOf(welded),
      errorWorld: Math.max(...children.map((child) => child.errorWorld)),
      lowBenefit: true,
    };
  }
}

export function childNodes(index: Map<string, ClodPageNode>[], level: number, nx: number, nz: number): ClodPageNode[] {
  const children: ClodPageNode[] = [];
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const child = index[level - 1]?.get(`${nx * 2 + dx},${nz * 2 + dz}`);
      if (child) children.push(child);
    }
  }
  requireFourChildren(level, nx, nz, children);
  return children;
}
