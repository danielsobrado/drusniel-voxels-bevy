import * as THREE from "three";
import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { emitAudio } from "../../audio/index.js";
import type { GuiController } from "./gui_controller.js";

export interface ClodGuiDeps {
  world: number;
  worldOptions: readonly number[];
  isWebGpu: boolean;
  views: Iterable<{
    mat: { setWireframe: (on: boolean) => void; setTier: (tier: number) => void };
    mesh: THREE.Mesh;
    sourceNormals: Float32Array;
    recomputedNormals?: Float32Array | null;
  }>;
  materialController: {
    forEachMaterial: (fn: (mat: {
      setDebug: (opts: { normalColor: boolean; normalDivergence: boolean; divergenceGain: number }) => void;
      setSide: (side: THREE.Side) => void;
    }) => void) => void;
  };
  selectionController: { resetSelState: () => void; invalidate: () => void };
  farShellController: { setEnabled: (on: boolean) => void };
  nodeLabelOverlay: { setVisible: (on: boolean) => void };
  applyClodPerfMode: (enabled: boolean) => void;
  setMaterialTiersQuery: (enabled: boolean) => void;
  setWebGpuSelectionQuery: (enabled: boolean) => void;
  ensureClodErrorCompute: () => Promise<unknown>;
  updateSelection: () => void;
  updateInfo: () => void;
  applyColorByLodToMaterials: (on: boolean) => void;
  setColorByLodUserOverride: (on: boolean) => void;
  recomputedNormalsFor: (view: {
    mesh: THREE.Mesh;
    sourceNormals: Float32Array;
    recomputedNormals?: Float32Array | null;
  }) => Float32Array;
}

export interface ClodGuiResult {
  colorByLodController: GuiController | null;
}

export function createClodGui(
  gui: GUI,
  state: ClodAppState,
  deps: ClodGuiDeps,
): ClodGuiResult {
  gui
    .add({ world: String(deps.world) }, "world", deps.worldOptions.map(String))
    .name("world size (reloads)")
    .onChange((w: string) => {
      const next = new URLSearchParams(location.search);
      next.set("world", w);
      location.search = `?${next.toString()}`;
    });
  gui.add(state, "clodPerfMode").name("CLOD perf mode").onChange(deps.applyClodPerfMode);
  gui.add(state, "materialTiers").name("material tiers").onChange((enabled: boolean) => {
    deps.setMaterialTiersQuery(enabled);
    if (!enabled) {
      for (const v of deps.views) v.mat.setTier(0);
    }
  });
  gui.add(state, "webgpuSelection").name("WebGPU selection").onChange((enabled: boolean) => {
    deps.setWebGpuSelectionQuery(enabled);
    if (enabled) {
      void deps.ensureClodErrorCompute().then(() => {
        deps.selectionController.invalidate();
        deps.updateSelection();
        deps.updateInfo();
      });
      return;
    }
    deps.selectionController.invalidate();
    deps.updateSelection();
    deps.updateInfo();
  });
  gui.add(state, "farShellEnabled").name("far shell").onChange((on: boolean) => {
    deps.farShellController.setEnabled(on);
  });
  gui.add(state, "profileEnabled").name("profiling");
  gui.add(state, "thresholdPx", 0.1, 6, 0.05).name("error threshold px").onChange(deps.updateSelection);
  gui.add(state, "forceMaxLevel", ["auto", "0", "1", "2", "3"]).name("force max level").onChange(() => {
    deps.selectionController.resetSelState();
    deps.updateSelection();
  });
  gui.add(state, "enforce21").name("2:1 constraint").onChange(deps.updateSelection);
  gui.add(state, "freeze").name("freeze selection").onChange((on: boolean) => {
    emitAudio(on ? "clod.selection.freeze.on" : "clod.selection.freeze.off");
  });
  gui.add(state, "showBounds").name("page boundaries").onChange(() => {
    deps.updateSelection();
    emitAudio("clod.overlay.toggle");
  });
  gui.add(state, "showSeamPoints").name("same-LOD seam points").onChange(() => {
    deps.updateSelection();
    emitAudio("clod.overlay.toggle");
  });
  gui.add(state, "showCrossLodBorders").name("cross-LOD borders").onChange(() => {
    deps.updateSelection();
    emitAudio("clod.overlay.toggle");
  });
  gui.add(state, "showNodeLabels").name("show floating node labels").onChange((on: boolean) => {
    deps.nodeLabelOverlay.setVisible(on);
    emitAudio("clod.overlay.toggle");
  });
  gui.add(state, "showLockedBorderVertices").name("show locked border vertices").onChange(() => {
    deps.updateSelection();
    emitAudio("clod.locked-border.toggle");
  });
  gui.add(state, "wireframe").name("wireframe").onChange((on: boolean) => {
    for (const v of deps.views) v.mat.setWireframe(on);
    emitAudio("clod.wireframe.toggle");
  });
  gui.add(state, "normalColor").name("normal colours").onChange((on: boolean) => {
    deps.materialController.forEachMaterial((m) =>
      m.setDebug({
        normalColor: on,
        normalDivergence: state.normalDivergence as boolean,
        divergenceGain: state.divergenceGain as number,
      }),
    );
  });
  const normalDivergenceController = gui.add(state, "normalDivergence").name("normal divergence").onChange((on: boolean) => {
    deps.materialController.forEachMaterial((m) =>
      m.setDebug({
        normalColor: state.normalColor as boolean,
        normalDivergence: on,
        divergenceGain: state.divergenceGain as number,
      }),
    );
  });
  const divergenceGainController = gui.add(state, "divergenceGain", 1, 32, 0.5).name("divergence gain").onChange((gain: number) => {
    deps.materialController.forEachMaterial((m) =>
      m.setDebug({
        normalColor: state.normalColor as boolean,
        normalDivergence: state.normalDivergence as boolean,
        divergenceGain: gain,
      }),
    );
  });
  if (deps.isWebGpu) {
    normalDivergenceController.name("normal divergence (WebGL)");
    normalDivergenceController.disable();
    divergenceGainController.disable();
  }
  gui.add(state, "frontSideOnly").name("front side only").onChange((on: boolean) => {
    deps.materialController.forEachMaterial((m) => m.setSide(on ? THREE.FrontSide : THREE.DoubleSide));
  });
  gui.add(state, "recomputedNormals").name("recomputed normals").onChange((on: boolean) => {
    for (const v of deps.views) {
      const g = v.mesh.geometry as THREE.BufferGeometry;
      g.setAttribute("normal", new THREE.BufferAttribute(on ? deps.recomputedNormalsFor(v) : v.sourceNormals, 3));
      g.attributes.normal.needsUpdate = true;
    }
  });
  const colorByLodController = gui.add(state, "colorByLod").name("color by LOD").onChange((on: boolean) => {
    deps.setColorByLodUserOverride(true);
    deps.applyColorByLodToMaterials(on);
    emitAudio("clod.lod.toggle");
  });

  return { colorByLodController };
}
