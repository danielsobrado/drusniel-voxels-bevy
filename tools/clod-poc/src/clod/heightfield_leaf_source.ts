import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import type { Phase1TerrainConfig } from "../phase1/phase1_config.js";
import type { HeightfieldSampler } from "../phase1/heightfield_sampler.js";

export interface HeightfieldLeafBuild {
  leafNodes: ClodPageNode[];
  worldPages: number;
}

export function buildHeightfieldLeafNodes(
  worldPages: number,
  sampler: HeightfieldSampler,
  config: Phase1TerrainConfig,
): HeightfieldLeafBuild {
  const pages = Math.max(1, Math.floor(worldPages));
  const pageSizeM = sampler.field.worldSizeM / pages;
  const leafNodes: ClodPageNode[] = [];
  for (let nz = 0; nz < pages; nz++) {
    for (let nx = 0; nx < pages; nx++) {
      const footprint = footprintFor(0, nx, nz, pageSizeM);
      const mesh = buildLeafMesh(footprint, config.clod.leafSegments, sampler);
      validateLeafMesh(mesh, footprint, `L0:${nx},${nz}`);
      leafNodes.push({
        id: `L0:${nx},${nz}`,
        level: 0,
        children: [],
        mesh,
        footprint,
        bounds: boundsOf(mesh),
        errorWorld: 0,
        lowBenefit: false,
      });
    }
  }
  return { leafNodes, worldPages: pages };
}

function footprintFor(level: number, nx: number, nz: number, pageSizeM: number): PageFootprint {
  const span = pageSizeM * (1 << level);
  return { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
}

function buildLeafMesh(footprint: PageFootprint, segments: number, sampler: HeightfieldSampler): PageMesh {
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

export function boundsOf(mesh: PageMesh): { center: [number, number, number]; radius: number } {
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

export function validateLeafMesh(mesh: PageMesh, footprint: PageFootprint, id: string): void {
  if (!(footprint.maxX > footprint.minX) || !(footprint.maxZ > footprint.minZ)) throw new Error(`${id} invalid footprint`);
  if (mesh.indices.length === 0 || mesh.positions.length === 0) throw new Error(`${id} empty mesh`);
  for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error(`${id} has non-finite position`);
  for (const value of mesh.normals) if (!Number.isFinite(value)) throw new Error(`${id} has non-finite normal`);
  for (const value of mesh.materials) {
    if (!Number.isFinite(value) || value < 0 || value > 3) throw new Error(`${id} invalid material ${value}`);
  }
}
