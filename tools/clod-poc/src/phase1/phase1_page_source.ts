import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import type { HeightfieldSampler } from "./heightfield_sampler.js";

export interface Phase1PageBuildResult {
  roots: ClodPageNode[];
  nodesByLevel: Map<number, ClodPageNode[]>;
  worldPages: number;
}

const LEAF_SEGMENTS = 18;

function footprintFor(level: number, nx: number, nz: number, pageSizeM: number): PageFootprint {
  const span = pageSizeM * (1 << level);
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

function boundsOf(mesh: PageMesh): { center: [number, number, number]; radius: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxX = Math.max(maxX, mesh.positions[i]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(mesh.positions[i] - center[0], mesh.positions[i + 1] - center[1], mesh.positions[i + 2] - center[2]));
  }
  return { center, radius };
}

function buildMesh(footprint: PageFootprint, segments: number, sampler: HeightfieldSampler): PageMesh {
  const side = segments + 1;
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const materials = new Float32Array(side * side);
  const indices = new Uint32Array(segments * segments * 6);
  let vi = 0;
  for (let z = 0; z <= segments; z++) {
    const wz = footprint.minZ + (z / segments) * (footprint.maxZ - footprint.minZ);
    for (let x = 0; x <= segments; x++) {
      const wx = footprint.minX + (x / segments) * (footprint.maxX - footprint.minX);
      const sample = sampler.sample(wx, wz);
      const normal = sampler.normalAt(wx, wz);
      positions[vi * 3] = wx;
      positions[vi * 3 + 1] = sample.height;
      positions[vi * 3 + 2] = wz;
      normals[vi * 3] = normal[0];
      normals[vi * 3 + 1] = normal[1];
      normals[vi * 3 + 2] = normal[2];
      materials[vi] = sample.biome;
      vi++;
    }
  }
  let ii = 0;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[ii++] = a;
      indices[ii++] = c;
      indices[ii++] = b;
      indices[ii++] = b;
      indices[ii++] = c;
      indices[ii++] = d;
    }
  }
  return { positions, normals, materials, indices };
}

function assertMesh(mesh: PageMesh, id: string): void {
  if (mesh.indices.length === 0 || mesh.positions.length === 0) throw new Error(`[phase1] ${id} empty main mesh`);
  for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error(`[phase1] ${id} has NaN position`);
  for (const value of mesh.normals) if (!Number.isFinite(value)) throw new Error(`[phase1] ${id} has NaN normal`);
  for (const value of mesh.materials) if (!Number.isFinite(value) || value < 0 || value > 3) throw new Error(`[phase1] ${id} material weights out of range`);
}

function nodeFor(level: number, nx: number, nz: number, pageSizeM: number, sampler: HeightfieldSampler, children: ClodPageNode[]): ClodPageNode {
  const footprint = footprintFor(level, nx, nz, pageSizeM);
  // Keep page-edge vertex spacing aligned across LODs. This avoids T-junction cracks in
  // the Phase-1 visual gate without adding skirts or rebuilding pages on the frame path.
  const segments = LEAF_SEGMENTS * (1 << level);
  const mesh = buildMesh(footprint, segments, sampler);
  const id = `L${level}:${nx},${nz}`;
  assertMesh(mesh, id);
  const span = footprint.maxX - footprint.minX;
  return {
    id,
    level,
    children,
    mesh,
    footprint,
    bounds: boundsOf(mesh),
    errorWorld: level === 0 ? 0 : span * 0.012 * level,
    lowBenefit: false,
  };
}

export function buildPhase1PageTree(worldPages: number, sampler: HeightfieldSampler): Phase1PageBuildResult {
  const pages = Math.max(1, Math.floor(worldPages));
  const pageSizeM = sampler.field.worldSizeM / pages;
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const indexes: Map<string, ClodPageNode>[] = [];

  const lod0: ClodPageNode[] = [];
  const lod0Index = new Map<string, ClodPageNode>();
  for (let z = 0; z < pages; z++) {
    for (let x = 0; x < pages; x++) {
      const node = nodeFor(0, x, z, pageSizeM, sampler, []);
      lod0.push(node);
      lod0Index.set(`${x},${z}`, node);
    }
  }
  nodesByLevel.set(0, lod0);
  indexes[0] = lod0Index;

  let prevCount = pages;
  for (let level = 1; prevCount > 1; level++) {
    const count = Math.ceil(prevCount / 2);
    const levelNodes: ClodPageNode[] = [];
    const levelIndex = new Map<string, ClodPageNode>();
    for (let z = 0; z < count; z++) {
      for (let x = 0; x < count; x++) {
        const children: ClodPageNode[] = [];
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            const child = indexes[level - 1].get(`${x * 2 + dx},${z * 2 + dz}`);
            if (child) children.push(child);
          }
        }
        if (children.length === 0) continue;
        const node = nodeFor(level, x, z, pageSizeM, sampler, children);
        levelNodes.push(node);
        levelIndex.set(`${x},${z}`, node);
      }
    }
    nodesByLevel.set(level, levelNodes);
    indexes[level] = levelIndex;
    prevCount = count;
  }

  const topLevel = Math.max(...nodesByLevel.keys());
  return { roots: nodesByLevel.get(topLevel) ?? [], nodesByLevel, worldPages: pages };
}
