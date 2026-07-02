import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import type { Phase1DebugMode } from "./phase1_config.js";
import type { Phase1SceneParams } from "./phase1_scene_types.js";
import type { SelectionState } from "../clod/selection.js";
import type { EngineStatsTracker } from "../core/engine_stats.js";
import type { SurfBand } from "../water/surfBand.js";
import type { DeepOcean } from "../water/deepOcean.js";
import { HeightfieldSampler } from "./heightfield_sampler.js";
import { buildOuterBorderLocks } from "../lock.js";
import { buildHeightfieldLeafNodes } from "../clod/heightfield_leaf_source.js";
import { buildDerivedClodTree } from "../clod/page_tree_builder.js";
import { geometryForPhase1Node, createPhase1TerrainMaterial } from "./phase1_terrain_material.js";
import { generatePhase1Heightfield } from "./terrain_synthesis.js";
import { parsePhase1Config } from "./phase1_config.js";
import { updateProgress, allNodes, disposeDebugGroup } from "./phase1_scene_helpers.js";
import {
  trackedLineBasicMaterial,
  trackedPointsMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

export interface Phase1MutableState {
  selectionState: SelectionState;
  lastRendered: Set<string>;
  lastRenderedNodes: ClodPageNode[];
  freezeLodSelection: boolean;
  currentDebugMode: Phase1DebugMode;
  rebuildInProgress: boolean;
  nodeMeshes: Map<string, THREE.Mesh>;
  pageTree: ReturnType<typeof buildDerivedClodTree>;
  sampler: HeightfieldSampler;
  terrainMaterial: THREE.Material;
  heightfield: ReturnType<typeof generatePhase1Heightfield>;
  buildMs: number;
}

export interface Phase1StaticDeps {
  config: ReturnType<typeof parsePhase1Config>;
  params: Phase1SceneParams;
  coastConfig: BorderCoastOceanConfig;
  scene: THREE.Scene;
  stats: EngineStatsTracker;
  surf: SurfBand;
  deepOcean: DeepOcean;
  pageBoundaryGroup: THREE.Group;
  lockedBorderGroup: THREE.Group;
}

export interface Phase1TerrainActions {
  rebuildSelectionOverlays(nodes: readonly ClodPageNode[]): void;
  setTerrainDebugMode(mode: Phase1DebugMode): void;
  sourceTerrainTriangles(): number;
  excludedWaterTriangles(): number;
  rebuildTerrainForCoast(enabled: boolean): Promise<void>;
}

export function createTerrainActions(
  deps: Phase1StaticDeps,
  state: Phase1MutableState,
): Phase1TerrainActions {
  const { config, params, coastConfig, scene, stats, surf, deepOcean, pageBoundaryGroup, lockedBorderGroup } = deps;

  const rebuildSelectionOverlays = (nodes: readonly ClodPageNode[]) => {
    if (pageBoundaryGroup.visible) {
      disposeDebugGroup(pageBoundaryGroup);
      const positions: number[] = [];
      for (const node of nodes) {
        const { minX, minZ, maxX, maxZ } = node.footprint;
        const y = node.bounds.maxY + 0.5;
        positions.push(minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      pageBoundaryGroup.add(new THREE.LineSegments(
        geometry,
        trackedLineBasicMaterial({ color: 0xffff00, depthTest: false }, "phase1-page-boundaries"),
      ));
    }
    if (lockedBorderGroup.visible) {
      disposeDebugGroup(lockedBorderGroup);
      const positions: number[] = [];
      for (const node of nodes) {
        const locks = buildOuterBorderLocks(node.mesh);
        for (let v = 0; v < locks.length; v += 1) {
          if (!locks[v]) continue;
          positions.push(node.mesh.positions[v * 3], node.mesh.positions[v * 3 + 1] + 0.4, node.mesh.positions[v * 3 + 2]);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      lockedBorderGroup.add(new THREE.Points(
        geometry,
        trackedPointsMaterial({ color: 0xff3344, size: 4, sizeAttenuation: false, depthTest: false }, "phase1-locked-borders"),
      ));
    }
  };

  const setTerrainDebugMode = (mode: Phase1DebugMode) => {
    if (mode === state.currentDebugMode) return;
    state.currentDebugMode = mode;
    state.terrainMaterial.dispose();
    state.terrainMaterial = createPhase1TerrainMaterial(mode);
    for (const node of allNodes(state.pageTree.nodesByLevel)) {
      const mesh = state.nodeMeshes.get(node.id);
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.geometry = geometryForPhase1Node(node, state.sampler, config, mode);
      mesh.material = state.terrainMaterial;
    }
    stats.stats.counters["phase1.debugMode"] = config.debug.modes.indexOf(mode);
  };

  const sourceTerrainTriangles = (): number => {
    return (state.pageTree.nodesByLevel.get(0) ?? [])
      .reduce((total, node) => total + node.mesh.indices.length / 3, 0);
  };

  const excludedWaterTriangles = (): number => {
    return surf.stats().triangles + deepOcean.stats().totalTriangles;
  };

  const rebuildTerrainForCoast = async (enabled: boolean): Promise<void> => {
    if (state.rebuildInProgress || coastConfig.coast.enabled === enabled) return;
    state.rebuildInProgress = true;
    coastConfig.coast.enabled = enabled;
    updateProgress(0.2, `phase1: rebuilding coast ${enabled ? "on" : "off"}`);
    try {
      const rebuildStart = performance.now();
      const nextHeightfield = generatePhase1Heightfield(params.seed, config, params.terrainGrid, coastConfig);
      const nextSampler = new HeightfieldSampler(nextHeightfield);
      const leaves = buildHeightfieldLeafNodes(params.worldPages, nextSampler, config);
      const nextTree = buildDerivedClodTree(leaves.leafNodes, leaves.worldPages, { ...config.clod, maxParentLevel: config.clod.maxParentLevel });
      for (const mesh of state.nodeMeshes.values()) { scene.remove(mesh); mesh.geometry.dispose(); }
      state.terrainMaterial.dispose();
      state.terrainMaterial = createPhase1TerrainMaterial(state.currentDebugMode);
      state.nodeMeshes = new Map();
      state.heightfield = nextHeightfield;
      state.sampler = nextSampler;
      state.pageTree = nextTree;
      for (const node of allNodes(state.pageTree.nodesByLevel)) {
        const mesh = new THREE.Mesh(geometryForPhase1Node(node, state.sampler, config, state.currentDebugMode), state.terrainMaterial);
        mesh.name = `phase1-${node.id}`;
        mesh.visible = false;
        state.nodeMeshes.set(node.id, mesh);
        scene.add(mesh);
      }
      state.selectionState = { split: new Set() };
      state.lastRendered.clear();
      state.lastRenderedNodes = [];
      state.buildMs = performance.now() - rebuildStart;
      stats.stats.counters["phase1.buildMs100"] = Math.round(state.buildMs * 100);
      stats.stats.counters["coast.enabled"] = enabled ? 1 : 0;
    } finally {
      state.rebuildInProgress = false;
      updateProgress(1, "ready");
    }
  };

  return { rebuildSelectionOverlays, setTerrainDebugMode, sourceTerrainTriangles, excludedWaterTriangles, rebuildTerrainForCoast };
}
