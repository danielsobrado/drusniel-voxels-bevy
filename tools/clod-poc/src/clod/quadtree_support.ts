import { ClodBuildError, ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import { ClodPagesConfig } from "../config.js";
import type { BuildResult } from "./quadtree.js";

export const INITIAL_NODE_REVISION = 1;

export interface Lod0NodeBackup {
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  revision?: number;
  chunkMeshes?: PageMesh[];
}

export interface ParentNodeBackup {
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  revision?: number;
  errorWorld: number;
  lowBenefit: boolean;
}

export const tris = (mesh: PageMesh): number => mesh.indices.length / 3;

export function ensureNodeRevision(node: ClodPageNode): number {
  if (typeof node.revision === "number" && Number.isFinite(node.revision)) return node.revision;
  node.revision = INITIAL_NODE_REVISION;
  return node.revision;
}

export function bumpNodeRevision(node: ClodPageNode): number {
  node.revision = ensureNodeRevision(node) + 1;
  return node.revision;
}

export function footprintFor(level: number, nx: number, nz: number, cfg: ClodPagesConfig): PageFootprint {
  const span = (1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size;
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

export function clonePageMesh(mesh: PageMesh): PageMesh {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    paintSlots: mesh.paintSlots.slice(),
    materialWeights: mesh.materialWeights.slice(),
    materialWeightStride: mesh.materialWeightStride,
    indices: mesh.indices.slice(),
  };
}

function cloneBounds(bounds: ClodPageNode["bounds"]): ClodPageNode["bounds"] {
  return {
    center: [...bounds.center],
    radius: bounds.radius,
    minY: bounds.minY,
    maxY: bounds.maxY,
  };
}

export function backupLod0Node(node: ClodPageNode): Lod0NodeBackup {
  return {
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    revision: node.revision,
    chunkMeshes: node.chunkMeshes ? [...node.chunkMeshes] : undefined,
  };
}

export function backupAllLod0Nodes(result: BuildResult): Map<ClodPageNode, Lod0NodeBackup> {
  const backups = new Map<ClodPageNode, Lod0NodeBackup>();
  for (const node of result.nodesByLevel.get(0) ?? []) backups.set(node, backupLod0Node(node));
  return backups;
}

export function restoreLod0Backups(backups: ReadonlyMap<ClodPageNode, Lod0NodeBackup>): void {
  for (const [node, backup] of backups) {
    node.mesh = backup.mesh;
    node.bounds = cloneBounds(backup.bounds);
    node.revision = backup.revision;
    if (backup.chunkMeshes) node.chunkMeshes = backup.chunkMeshes;
    else delete node.chunkMeshes;
  }
}

export function backupParentNode(node: ClodPageNode): ParentNodeBackup {
  return {
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    revision: node.revision,
    errorWorld: node.errorWorld,
    lowBenefit: node.lowBenefit,
  };
}

export function restoreParentBackups(backups: ReadonlyMap<ClodPageNode, ParentNodeBackup>): void {
  for (const [node, backup] of backups) {
    node.mesh = backup.mesh;
    node.bounds = cloneBounds(backup.bounds);
    node.revision = backup.revision;
    node.errorWorld = backup.errorWorld;
    node.lowBenefit = backup.lowBenefit;
  }
}

export function boundsOf(mesh: PageMesh): { center: [number, number, number]; radius: number; minY: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    radius = Math.max(
      radius,
      Math.hypot(mesh.positions[i] - center[0], mesh.positions[i + 1] - center[1], mesh.positions[i + 2] - center[2]),
    );
  }
  return { center, radius, minY, maxY };
}

export function estimatedNodeCount(worldPagesX: number, worldPagesZ: number, levels: number): number {
  let total = 0;
  let countX = worldPagesX;
  let countZ = worldPagesZ;
  for (let level = 0; level < levels; level++) {
    total += countX * countZ;
    if (countX === 1 && countZ === 1) break;
    countX = Math.ceil(countX / 2);
    countZ = Math.ceil(countZ / 2);
  }
  return total;
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== "undefined" && !document.hidden && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function resolveBuildShape(worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig): { maxLevels: number } {
  const maxLevels = Math.min(
    cfg.page.quadtree_levels,
    Math.floor(Math.log2(Math.min(worldPagesX, worldPagesZ))) + 1,
  );
  const requiredMultiple = 1 << (maxLevels - 1);
  if (worldPagesX % requiredMultiple !== 0 || worldPagesZ % requiredMultiple !== 0) {
    throw new ClodBuildError(
      "PageIncomplete",
      `world pages ${worldPagesX}x${worldPagesZ} not a multiple of ${requiredMultiple} for ${maxLevels} levels`,
    );
  }
  return { maxLevels };
}

export function requireFourChildren(level: number, nx: number, nz: number, children: readonly ClodPageNode[]): void {
  if (children.length !== 4) {
    throw new ClodBuildError("PageIncomplete", `parent L${level}:${nx},${nz} expected 4 children, got ${children.length}`);
  }
}

export function childNodes(index: Map<string, ClodPageNode>[], level: number, nx: number, nz: number): ClodPageNode[] {
  const children: ClodPageNode[] = [];
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const child = index[level - 1].get(`${nx * 2 + dx},${nz * 2 + dz}`);
      if (child) children.push(child);
    }
  }
  requireFourChildren(level, nx, nz, children);
  return children;
}
