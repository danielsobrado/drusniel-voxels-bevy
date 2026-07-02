import * as THREE from "three";
import { selectCut } from "../clod/selection.js";
import { countLevel, countBuiltLevel } from "./phase1_scene_helpers.js";

export function createPhase1AnimationLoop(deps: {
  renderer: { domElement: HTMLCanvasElement; render: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void };
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  flyCamera: { update(dt: number): void; enabled: boolean };
  params: { freeze: boolean };
  config: { selection: { errorThresholdPx: number; hysteresisMergeFactor: number; enforce21: boolean }; runtime: { farViewM: number } };
  stats: { stats: { counters: Record<string, number>; frame: number }; update(dt: number): void };
  hud: { update(dt: number): void };
  surf: { update(dt: number): void; object: THREE.Object3D; stats(): { triangles: number } };
  deepOcean: { update(dt: number, pos: THREE.Vector3): void; object: THREE.Object3D; stats(): { totalTriangles: number; drawCalls: number; snapUpdates: number } };
  borderDebug: { updateProbe(pos: THREE.Vector3): void; stats: { coastType: string; distanceToBorder: number } };
  pageInputDebug: { update(sourceTris: number, excludedTris: number): void };
  oceanDebug: { update(): void };
  settleManager: { update(frame: number): void };
  state: {
    selectionState: { split: Set<string> };
    lastRendered: Set<string>;
    lastRenderedNodes: any[];
    freezeLodSelection: boolean;
    nodeMeshes: Map<string, { visible: boolean }>;
    pageTree: { roots: any[]; nodesByLevel: Map<number, any[]> };
  };
  actions: {
    rebuildSelectionOverlays(nodes: readonly any[]): void;
    sourceTerrainTriangles(): number;
    excludedWaterTriangles(): number;
  };
  coastConfig: { coast: { enabled: boolean } };
}): (timeMs: number) => void {
  let last = performance.now();

  return (timeMs: number) => {
    const dt = Math.max(0.0001, Math.min((timeMs - last) / 1000, 0.1));
    last = timeMs;
    if (!deps.params.freeze) deps.flyCamera.update(dt);

    const selectStart = performance.now();
    let renderedNodes = deps.state.lastRenderedNodes;
    if (!deps.state.freezeLodSelection || renderedNodes.length === 0) {
      const selection = selectCut(deps.state.pageTree.roots, {
        thresholdPx: deps.config.selection.errorThresholdPx,
        hysteresisMergeFactor: deps.config.selection.hysteresisMergeFactor,
        enforce21: deps.config.selection.enforce21,
        viewportH: deps.renderer.domElement.height,
        fovY: THREE.MathUtils.degToRad(deps.camera.fov),
        camPos: [deps.camera.position.x, deps.camera.position.y, deps.camera.position.z],
      }, deps.state.selectionState);
      deps.state.selectionState = selection.state;
      renderedNodes = selection.rendered;
    }

    const nextRendered = new Set(renderedNodes.map((node: any) => node.id));
    const cutChanged = nextRendered.size !== deps.state.lastRendered.size
      || [...nextRendered].some((id) => !deps.state.lastRendered.has(id));
    for (const id of deps.state.lastRendered) {
      if (!nextRendered.has(id)) {
        const mesh = deps.state.nodeMeshes.get(id);
        if (mesh) mesh.visible = false;
      }
    }
    for (const node of renderedNodes) {
      const mesh = deps.state.nodeMeshes.get(node.id);
      if (mesh) mesh.visible = true;
    }
    deps.state.lastRendered = nextRendered;
    deps.state.lastRenderedNodes = renderedNodes;
    if (cutChanged) deps.actions.rebuildSelectionOverlays(renderedNodes);

    const selectionMs = performance.now() - selectStart;
    const renderedTris = renderedNodes.reduce((sum: number, node: any) => sum + node.mesh.indices.length / 3, 0);
    const cnt = deps.stats.stats.counters;
    cnt["phase1.nodesRendered"] = renderedNodes.length;
    cnt["phase1.trianglesRendered"] = renderedTris;
    cnt["phase1.lod0Nodes"] = countLevel(renderedNodes, 0);
    cnt["phase1.lod1Nodes"] = countLevel(renderedNodes, 1);
    cnt["phase1.lod2Nodes"] = countLevel(renderedNodes, 2);
    cnt["phase1.lod3Nodes"] = countLevel(renderedNodes, 3);
    cnt["phase1.builtLod0Nodes"] = countBuiltLevel(deps.state.pageTree.nodesByLevel, 0);
    cnt["phase1.builtLod1Nodes"] = countBuiltLevel(deps.state.pageTree.nodesByLevel, 1);
    cnt["phase1.builtLod2Nodes"] = countBuiltLevel(deps.state.pageTree.nodesByLevel, 2);
    cnt["phase1.builtLod3Nodes"] = countBuiltLevel(deps.state.pageTree.nodesByLevel, 3);
    cnt["phase1.selectionMs100"] = Math.round(selectionMs * 100);

    deps.surf.update(dt);
    deps.deepOcean.update(dt, deps.camera.position);
    deps.borderDebug.updateProbe(deps.camera.position);
    const sourceTriangles = deps.actions.sourceTerrainTriangles();
    const excludedTriangles = deps.actions.excludedWaterTriangles();
    deps.pageInputDebug.update(sourceTriangles, excludedTriangles);
    deps.oceanDebug.update();
    const oceanStats = deps.deepOcean.stats();
    const coastTypeIds: Record<string, number> = { inland: 0, sandyBeach: 1, rockyBeach: 2, cliff: 3, cove: 4, reef: 5 };
    cnt["coast.enabled"] = deps.coastConfig.coast.enabled ? 1 : 0;
    cnt["coast.type"] = coastTypeIds[deps.borderDebug.stats.coastType] ?? 0;
    cnt["coast.distanceToBorder100"] = Math.round(deps.borderDebug.stats.distanceToBorder * 100);
    cnt["clod.pageSourceTerrainTriangles"] = sourceTriangles;
    cnt["clod.excludedWaterOceanTriangles"] = excludedTriangles;
    cnt["clod.waterTrianglesInSimplifier"] = 0;
    cnt["water.surfTriangles"] = deps.surf.object.visible ? deps.surf.stats().triangles : 0;
    cnt["water.deepOceanTriangles"] = deps.deepOcean.object.visible ? oceanStats.totalTriangles : 0;
    cnt["water.oceanDrawCalls"] = oceanStats.drawCalls;
    cnt["water.oceanSnapUpdates"] = oceanStats.snapUpdates;

    deps.renderer.render(deps.scene, deps.camera);
    deps.stats.update(dt);
    deps.hud.update(dt);

    deps.settleManager.update(deps.stats.stats.frame);
  };
}
