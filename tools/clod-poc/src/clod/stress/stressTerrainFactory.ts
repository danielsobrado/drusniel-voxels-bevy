import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodBoundingSphere } from "../runtime/clodRuntimeTypes.js";
import type { ClodPageNode } from "../../types.js";
import { fixtureByName, type FixtureDef } from "../stressFixtures.js";
import type { StressSceneParams } from "./stressSceneConfig.js";
import type { TerrainBuildResult, StressTerrainDebugMode } from "./stress_terrain_factory_types.js";
import { buildQuadtreeNodes } from "./stress_terrain_factory_build.js";

export type { TerrainBuildResult, StressTerrainDebugMode } from "./stress_terrain_factory_types.js";
export { buildQuadtreeNodes } from "./stress_terrain_factory_build.js";

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
    for (const child of node.children) {
      if (child) childIds.push(child.id);
    }

    const rtNode: ClodPageNodeRuntime = {
      id: node.id,
      level: node.level,
      parentId: null,
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

  for (const [id] of runtimeNodes) {
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
  for (const [, runtimeNode] of result.nodes) {
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
      const level = Number(/^L(\d+):/.exec(runtimeNode.id)?.[1] ?? 0);
      material.color.setHex(lodColors[level % lodColors.length]);
    } else {
      material.color.setHex(0x88aa77);
    }
    material.needsUpdate = true;
  }
}
