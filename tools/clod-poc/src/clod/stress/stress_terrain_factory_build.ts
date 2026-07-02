import type { ClodPageNode, PageMesh } from "../../types.js";
import type { FixtureDef } from "../stressFixtures.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export function buildQuadtreeNodes(
  fixture: FixtureDef,
  params: StressSceneParams,
): { roots: ClodPageNode[]; allNodes: ClodPageNode[] } {
  const { lod0PagesX, lod0PagesZ, chunksPerPage, chunkSize } = params;
  const leafSize = chunkSize * chunksPerPage;

  const leafNodes: ClodPageNode[] = [];
  for (let pz = 0; pz < lod0PagesZ; pz++) {
    for (let px = 0; px < lod0PagesX; px++) {
      const minX = px * leafSize;
      const minZ = pz * leafSize;
      const maxX = minX + leafSize;
      const maxZ = minZ + leafSize;
      const mesh = buildFixtureMesh(fixture, minX, minZ, maxX, maxZ, chunkSize);
      leafNodes.push({
        id: `L0:${px},${pz}`,
        level: 0,
        children: [],
        mesh,
        footprint: { minX, minZ, maxX, maxZ },
        bounds: computeBounds(mesh, minX, minZ, maxX, maxZ),
        errorWorld: computeErrorWorld(mesh),
        lowBenefit: false,
      });
    }
  }

  const allNodes = [...leafNodes];
  const nodeMap = new Map<string, ClodPageNode>();
  for (const node of leafNodes) nodeMap.set(node.id, node);

  const maxLevel = Math.min(3, Math.ceil(Math.log2(Math.max(lod0PagesX, lod0PagesZ))));

  for (let level = 1; level <= maxLevel; level++) {
    const childLevel = level - 1;
    const parentStep = 1 << level;
    const parentCountX = Math.ceil(lod0PagesX / parentStep);
    const parentCountZ = Math.ceil(lod0PagesZ / parentStep);

    for (let pz = 0; pz < parentCountZ; pz++) {
      for (let px = 0; px < parentCountX; px++) {
        const id = `L${level}:${px},${pz}`;
        if (nodeMap.has(id)) continue;

        const children: (ClodPageNode | null)[] = [];
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            const childId = `L${childLevel}:${px * 2 + dx},${pz * 2 + dz}`;
            children.push(nodeMap.get(childId) ?? null);
          }
        }

        const validChildren = children.filter((c): c is ClodPageNode => !!c);
        if (validChildren.length === 0) continue;

        const minX = validChildren[0].footprint.minX;
        const minZ = validChildren[0].footprint.minZ;
        const maxX = validChildren[validChildren.length - 1].footprint.maxX;
        const maxZ = validChildren[validChildren.length - 1].footprint.maxZ;

        const parentMesh = mergeMeshes(validChildren.map((c) => c.mesh));
        const errorWorld = Math.max(
          computeErrorWorld(parentMesh),
          ...validChildren.map((c) => c.errorWorld),
        );

        const node: ClodPageNode = {
          id,
          level,
          children,
          mesh: parentMesh,
          footprint: { minX, minZ, maxX, maxZ },
          bounds: computeBounds(parentMesh, minX, minZ, maxX, maxZ),
          errorWorld,
          lowBenefit: false,
        };
        nodeMap.set(id, node);
        allNodes.push(node);
      }
    }
  }

  const roots = allNodes.filter((n) => {
    return n.level === maxLevel || !allNodes.some((p) => p.children.some((c) => c && c.id === n.id));
  });

  return { roots, allNodes };
}

function buildFixtureMesh(
  fixture: FixtureDef,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chunkSize: number,
): PageMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const paintSlots: number[] = [];
  const indices: number[] = [];
  const eps = 0.01;

  const cellsX = Math.ceil((maxX - minX) / (chunkSize / 2));
  const cellsZ = Math.ceil((maxZ - minZ) / (chunkSize / 2));
  const cellSizeX = (maxX - minX) / cellsX;
  const cellSizeZ = (maxZ - minZ) / cellsZ;

  for (let j = 0; j <= cellsZ; j++) {
    for (let i = 0; i <= cellsX; i++) {
      const wx = minX + i * cellSizeX;
      const wz = minZ + j * cellSizeZ;
      const h = fixture.height(wx, wz);
      const nx = fixture.height(wx + eps, wz);
      const nz = fixture.height(wx, wz + eps);
      const dx = (nx - h) / eps;
      const dz = (nz - h) / eps;
      const len = Math.hypot(-dx, 1, -dz);
      positions.push(wx, h, wz);
      normals.push(-dx / len, 1 / len, -dz / len);
      paintSlots.push(fixture.material(wx, wz));
    }
  }

  for (let j = 0; j < cellsZ; j++) {
    for (let i = 0; i < cellsX; i++) {
      const a = j * (cellsX + 1) + i;
      const b = a + 1;
      const c = (j + 1) * (cellsX + 1) + i;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const vc = positions.length / 3;
  const weights = new Float32Array(vc * 4);
  for (let wi = 0; wi < vc; wi++) {
    const x = positions[wi * 3];
    const z = positions[wi * 3 + 2];
    const fixtureWeights = fixture.materialWeights?.(x, z);
    if (fixtureWeights) {
      const sum = fixtureWeights.reduce((total, weight) => total + Math.max(0, weight), 0);
      for (let slot = 0; slot < 4; slot += 1) {
        weights[wi * 4 + slot] = sum > 0 ? Math.max(0, fixtureWeights[slot]) / sum : 0;
      }
    } else {
      const slot = Math.min(Math.max(0, Math.round(paintSlots[wi])), 3);
      weights[wi * 4 + slot] = 1;
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(paintSlots),
    materialWeights: weights,
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function mergeMeshes(meshes: PageMesh[]): PageMesh {
  if (meshes.length === 0) throw new Error("no meshes to merge");
  if (meshes.length === 1) {
    const m = meshes[0];
    return {
      positions: new Float32Array(m.positions),
      normals: new Float32Array(m.normals),
      paintSlots: new Float32Array(m.paintSlots),
      materialWeights: new Float32Array(m.materialWeights),
      materialWeightStride: m.materialWeightStride,
      indices: new Uint32Array(m.indices),
    };
  }

  const totalVerts = meshes.reduce((s, m) => s + m.positions.length / 3, 0);
  const totalIndices = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const paintSlots = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);
  const stride = meshes[0].materialWeightStride;
  const weights = new Float32Array(totalVerts * stride);

  let voff = 0;
  let ioff = 0;
  for (const m of meshes) {
    const vc = m.positions.length / 3;
    positions.set(m.positions, voff * 3);
    normals.set(m.normals, voff * 3);
    paintSlots.set(m.paintSlots, voff);
    weights.set(m.materialWeights, voff * stride);
    for (let ii = 0; ii < m.indices.length; ii++) {
      indices[ioff + ii] = m.indices[ii] + voff;
    }
    voff += vc;
    ioff += m.indices.length;
  }

  return { positions, normals, paintSlots, materialWeights: weights, materialWeightStride: stride, indices };
}

function computeBounds(mesh: PageMesh, minX: number, minZ: number, maxX: number, maxZ: number): {
  center: [number, number, number];
  radius: number;
  minY: number;
  maxY: number;
} {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const cy = (minY + maxY) / 2;
  const dx = maxX - minX;
  const dz = maxZ - minZ;
  const dy = maxY - minY;
  const radius = Math.hypot(dx, dy, dz) / 2;

  return { center: [cx, cy, cz], radius, minY, maxY };
}

function computeErrorWorld(mesh: PageMesh): number {
  if (mesh.positions.length < 9) return 0.01;
  let maxError = 0;
  const step = Math.max(1, Math.floor(mesh.positions.length / 300));
  for (let i = 0; i < mesh.positions.length; i += step * 3) {
    const y = mesh.positions[i + 1];
    maxError = Math.max(maxError, Math.abs(y));
  }
  return Math.max(0.01, maxError * 0.02);
}
