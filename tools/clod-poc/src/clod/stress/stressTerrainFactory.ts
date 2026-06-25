import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodBoundingSphere } from "../runtime/clodRuntimeTypes.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { fixtureByName, type FixtureDef } from "../stressFixtures.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export interface TerrainBuildResult {
  rootNodeIds: ClodNodeId[];
  nodes: Map<ClodNodeId, ClodPageNodeRuntime>;
  nodeDefs: Map<ClodNodeId, ClodPageNode>;
  scene: THREE.Scene;
  fixtureDef: FixtureDef;
}

function buildQuadtreeNodes(
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

export function buildTerrainForStressScene(
  params: StressSceneParams,
  scene: THREE.Scene,
): TerrainBuildResult {
  const fixture = fixtureByName(params.sceneName);
  if (!fixture) {
    throw new Error(`Unknown stress scene: ${params.sceneName}`);
  }

  return buildTerrainForFixture(fixture, params, scene);
}

export type StressTerrainDebugMode =
  | "final"
  | "lod"
  | "coastType"
  | "materialWeights"
  | "pageSourceSections";

export function buildTerrainForFixture(
  fixture: FixtureDef,
  params: StressSceneParams,
  scene: THREE.Scene,
): TerrainBuildResult {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: false,
    color: 0x88aa77,
    roughness: 0.85,
    metalness: 0,
    flatShading: false,
    side: THREE.DoubleSide,
  });

  const { roots: clodRoots, allNodes: clodAllNodes } = buildQuadtreeNodes(fixture, params);

  const runtimeNodes = new Map<ClodNodeId, ClodPageNodeRuntime>();
  const nodeDefs = new Map<ClodNodeId, ClodPageNode>();
  const rootNodeIds: ClodNodeId[] = [];

  for (const node of clodRoots) {
    rootNodeIds.push(node.id);
  }

  for (const node of clodAllNodes) {
    nodeDefs.set(node.id, node);

    const pos = node.mesh.positions;
    const norm = node.mesh.normals;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(norm), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(node.mesh.indices), 1));
    const coastColors = new Float32Array((pos.length / 3) * 3);
    const materialColors = new Float32Array((pos.length / 3) * 3);
    const sourceColors = new Float32Array((pos.length / 3) * 3);
    for (let vertex = 0; vertex < pos.length / 3; vertex += 1) {
      const x = pos[vertex * 3];
      const z = pos[vertex * 3 + 2];
      const coastColor = fixture.coastTypeColor?.(x, z) ?? [0.2, 0.85, 0.3];
      coastColors.set(coastColor, vertex * 3);
      const grass = node.mesh.materialWeights[vertex * 4] ?? 0;
      const sand = node.mesh.materialWeights[vertex * 4 + 1] ?? 0;
      const rock = node.mesh.materialWeights[vertex * 4 + 2] ?? 0;
      materialColors.set([grass * 0.2 + sand * 0.9 + rock * 0.45, grass * 0.75 + sand * 0.65 + rock * 0.3, grass * 0.18 + sand * 0.25 + rock * 0.22], vertex * 3);
      sourceColors.set([0.2, 0.85, 0.3], vertex * 3);
    }
    geo.setAttribute("coastTypeColor", new THREE.BufferAttribute(coastColors, 3));
    geo.setAttribute("materialWeightColor", new THREE.BufferAttribute(materialColors, 3));
    geo.setAttribute("pageSourceSectionColor", new THREE.BufferAttribute(sourceColors, 3));

    const mesh = new THREE.Mesh(geo, material.clone());
    mesh.name = `clod-${node.id}`;
    mesh.visible = false;
    scene.add(mesh);

    const bs: ClodBoundingSphere = {
      center: [node.bounds.center[0], node.bounds.center[1], node.bounds.center[2]],
      radius: node.bounds.radius,
    };

    const childIds: ClodNodeId[] = [];
    const parentId: ClodNodeId | null = null;

    for (const child of node.children) {
      if (child) childIds.push(child.id);
    }

    const rtNode: ClodPageNodeRuntime = {
      id: node.id,
      level: node.level,
      parentId,
      childIds,
      footprint: node.footprint,
      boundingSphere: bs,
      errorWorld: node.errorWorld,
      minY: node.bounds.minY,
      maxY: node.bounds.maxY,
      mesh,
      ready: true,
      lowBenefit: node.lowBenefit,
    };

    runtimeNodes.set(node.id, rtNode);
  }

  for (const [id, _node] of runtimeNodes) {
    const def = nodeDefs.get(id);
    if (!def) continue;
    for (const child of def.children) {
      if (child) {
        const rtChild = runtimeNodes.get(child.id);
        if (rtChild) {
          (rtChild as { parentId: ClodNodeId | null }).parentId = id;
        }
      }
    }
  }

  const result = { rootNodeIds, nodes: runtimeNodes, nodeDefs, scene, fixtureDef: fixture };
  scene.userData["borderCoastStress"] = {
    fixture: fixture.name,
    debugOverlays: [
      "pageBoundaries",
      "lodLevelColors",
      "lockedBorderVertices",
      "coastTypeColor",
      "materialWeightDebug",
      "pageSourceSectionDebug",
      "simplificationErrorLabels",
    ],
    pageSourceKinds: ["mainTerrain"],
    waterTrianglesInSimplifiedPages: 0,
  };
  return result;
}

export function setStressTerrainDebugMode(
  result: { nodes: Map<ClodNodeId, ClodPageNodeRuntime> },
  mode: StressTerrainDebugMode,
): void {
  const lodColors = [0x4488ff, 0x44ff88, 0xff8844, 0xff4488];
  for (const [id, runtimeNode] of result.nodes) {
    const mesh = runtimeNode.mesh;
    if (!mesh) continue;
    const geometry = mesh.geometry;
    if (mode === "coastType") geometry.setAttribute("color", geometry.getAttribute("coastTypeColor"));
    else if (mode === "materialWeights") geometry.setAttribute("color", geometry.getAttribute("materialWeightColor"));
    else if (mode === "pageSourceSections") geometry.setAttribute("color", geometry.getAttribute("pageSourceSectionColor"));
    else geometry.deleteAttribute("color");
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.vertexColors = mode === "coastType" || mode === "materialWeights" || mode === "pageSourceSections";
    if (mode === "lod") {
      const level = Number(/^L(\d+):/.exec(id)?.[1] ?? 0);
      material.color.setHex(lodColors[level % lodColors.length]);
    } else {
      material.color.setHex(0x88aa77);
    }
    material.needsUpdate = true;
  }
}
