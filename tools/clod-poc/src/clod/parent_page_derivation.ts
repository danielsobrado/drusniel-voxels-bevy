import type { ClodPagesConfig } from "../config.js";
import { countLocks } from "../lock.js";
import { simplifyPage } from "../simplify.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import { assertNoInternalBorders, stripDegenerateTriangles } from "../validate.js";
import { buildOuterBorderLocks } from "../lock.js";
import { boundsOf } from "./heightfield_leaf_source.js";
import { validatePageBorderChains } from "./page_border_lock.js";
import { computeParentErrorWorld } from "./page_error_metric.js";
import { mergeChildPageMeshes, validateFiniteMesh } from "./page_mesh_merge.js";

export interface ClodDerivationConfig {
  simplifyTargetRatio: number;
  minParentSegments: number;
  borderLockEpsilonM: number;
  borderChainSearchBandM: number;
  errorScale: number;
}

export interface DerivedParentPage {
  node: ClodPageNode;
  borderChainsChecked: number;
  lockedVertices: number;
  sourceTriangles: number;
  outputTriangles: number;
  internalBorderChecks: number;
}

export function deriveParentPage(
  level: number,
  nx: number,
  nz: number,
  children: readonly ClodPageNode[],
  config: ClodDerivationConfig,
): DerivedParentPage {
  if (children.length === 0) throw new Error(`cannot derive L${level}:${nx},${nz} without children`);
  const footprint = footprintFromChildren(children);
  const sourceMesh = mergeChildPageMeshes(children, config.borderLockEpsilonM);
  stripDegenerateTriangles(sourceMesh);
  recomputeNormals(sourceMesh);
  assertNoInternalBorders(sourceMesh, footprint);

  const locks = buildOuterBorderLocks(sourceMesh);
  const simplified = simplifyPage(sourceMesh, locks, simplifyConfig(config), { preserveMaterials: true });
  stripDegenerateTriangles(simplified.mesh);
  recomputeNormals(simplified.mesh);
  assertNoInternalBorders(simplified.mesh, footprint);
  validateFiniteMesh(simplified.mesh, `L${level}:${nx},${nz}`);
  const borderChainsChecked = validatePageBorderChains(
    simplified.mesh,
    footprint,
    config.borderLockEpsilonM,
    config.borderChainSearchBandM,
  );
  const computedError = computeParentErrorWorld(simplified.mesh, sourceMesh, children) * config.errorScale;
  const childError = Math.max(...children.map((child) => child.errorWorld));
  const errorWorld = Math.max(computedError, childError);
  const b = boundsOf(simplified.mesh);
  const node: ClodPageNode = {
    id: `L${level}:${nx},${nz}`,
    level,
    children: [...children],
    mesh: simplified.mesh,
    footprint,
    bounds: b,
    errorWorld,
    lowBenefit: simplified.lowBenefit,
  };
  return {
    node,
    borderChainsChecked,
    lockedVertices: countLocks(locks),
    sourceTriangles: sourceMesh.indices.length / 3,
    outputTriangles: simplified.mesh.indices.length / 3,
    internalBorderChecks: 2,
  };
}

export function footprintFromChildren(children: readonly ClodPageNode[]): PageFootprint {
  return {
    minX: Math.min(...children.map((child) => child.footprint.minX)),
    minZ: Math.min(...children.map((child) => child.footprint.minZ)),
    maxX: Math.max(...children.map((child) => child.footprint.maxX)),
    maxZ: Math.max(...children.map((child) => child.footprint.maxZ)),
  };
}

export function recomputeNormals(mesh: PageMesh): void {
  mesh.normals.fill(0);
  const idx = mesh.indices;
  const pos = mesh.positions;
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3;
    const ib = idx[i + 1] * 3;
    const ic = idx[i + 2] * 3;
    const abx = pos[ib] - pos[ia];
    const aby = pos[ib + 1] - pos[ia + 1];
    const abz = pos[ib + 2] - pos[ia + 2];
    const acx = pos[ic] - pos[ia];
    const acy = pos[ic + 1] - pos[ia + 1];
    const acz = pos[ic + 2] - pos[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vi of [ia, ib, ic]) {
      mesh.normals[vi] += nx;
      mesh.normals[vi + 1] += ny;
      mesh.normals[vi + 2] += nz;
    }
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    if (len > 0.000001) {
      mesh.normals[i] /= len;
      mesh.normals[i + 1] /= len;
      mesh.normals[i + 2] /= len;
    } else {
      mesh.normals[i] = 0;
      mesh.normals[i + 1] = 1;
      mesh.normals[i + 2] = 0;
    }
  }
}

function simplifyConfig(config: ClodDerivationConfig): ClodPagesConfig {
  // Only simplify.* fields are consumed by simplifyPage(). Selection fields here are
  // inert placeholders required by the current ClodPagesConfig type.
  // TODO: split SimplifyConfig from ClodPagesConfig.
  return {
    page: {
      chunks_per_page: 1,
      chunk_size: Math.max(1, config.minParentSegments),
      halo_chunks: 0,
      quadtree_levels: 1,
    },
    simplify: {
      target_ratio_per_level: config.simplifyTargetRatio,
      abandon_ratio: 0.98,
      target_error: Number.POSITIVE_INFINITY,
      weld_epsilon_cells: config.borderLockEpsilonM,
      attribute_weights: { normal: 1, material: 0.25 },
    },
    polish: {
      diagonal_flip: {
        enabled: false,
        min_triangle_area: 0.000001,
        min_normal_dot: 0.05,
        min_angle_improvement_degrees: 2,
        normal_error_weight: 1,
        angle_quality_weight: 1,
        material_error_weight: 0.25,
      },
    },
    selection: {
      error_threshold_px: 24,
      hysteresis_merge_factor: 1.35,
      neighbor_level_delta_max: 1,
      transition_mode: "instant",
      crossfade_frames: 0,
    },
    near_field: { radius_chunks: 0 },
    meshopt_package_version: "phase1-shared",
    poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: false, emit_debug_obj: false },
    validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
  };
}
