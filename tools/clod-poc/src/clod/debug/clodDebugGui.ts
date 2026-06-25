import GUI from "lil-gui";
import type { ClodRuntimeState } from "../runtime/clodRuntime.js";
import type { ClodRuntimeConfig } from "../runtime/clodRuntimeTypes.js";
import { setFreezeSelection, setEnforce21, setCrossfadeEnabled } from "../runtime/clodRuntime.js";

export interface ClodDebugGuiState {
  enableRuntime: boolean;
  freezeCut: boolean;
  enforce21: boolean;
  enableCrossfade: boolean;
  errorThresholdPx: number;
  hysteresisMergeFactor: number;
  neighborMaxLevelDelta: number;
  crossfadeFrames: number;

  showWireframe: boolean;
  showPageBoundaries: boolean;
  showLockedBorderVertices: boolean;
  showErrorLabels: boolean;
  showStatsPanel: boolean;
  showNearFieldMask: boolean;

  activeStressScene: string;
}

export function createClodDebugGui(
  parent: GUI,
  runtimeState: ClodRuntimeState,
  config: ClodRuntimeConfig,
  stressScenes: string[],
  onSceneChange: (scene: string) => void,
  overlays: {
    setWireframeVisible: (v: boolean) => void;
    setPageBoundariesVisible: (v: boolean) => void;
    setLockedBorderVisible: (v: boolean) => void;
    setErrorLabelsVisible: (v: boolean) => void;
    setStatsPanelVisible: (v: boolean) => void;
    setNearFieldMaskVisible: (v: boolean) => void;
  },
): ClodDebugGuiState {
  const guiState: ClodDebugGuiState = {
    enableRuntime: true,
    freezeCut: false,
    enforce21: true,
    enableCrossfade: true,
    errorThresholdPx: config.selection.errorThresholdPx,
    hysteresisMergeFactor: config.selection.hysteresisMergeFactor,
    neighborMaxLevelDelta: config.selection.neighborLevelDeltaMax,
    crossfadeFrames: config.selection.crossfadeFrames,

    showWireframe: config.debug.showWireframe,
    showPageBoundaries: config.debug.showPageBoundaries,
    showLockedBorderVertices: config.debug.showLockedBorderVertices,
    showErrorLabels: config.debug.showErrorLabels,
    showStatsPanel: config.debug.showStatsPanel,
    showNearFieldMask: config.nearField.showMask,

    activeStressScene: "ridge_border",
  };

  const runtimeFolder = parent.addFolder("CLOD Runtime");
  runtimeFolder.add(guiState, "enableRuntime").name("Enable CLOD runtime");
  runtimeFolder.add(guiState, "freezeCut").name("Freeze CLOD cut").onChange((v: boolean) => {
    setFreezeSelection(runtimeState, v);
  });
  runtimeFolder.add(guiState, "enforce21").name("Enable 2:1 restriction").onChange((v: boolean) => {
    setEnforce21(runtimeState, v);
  });
  runtimeFolder.add(guiState, "enableCrossfade").name("Enable crossfade").onChange((v: boolean) => {
    setCrossfadeEnabled(runtimeState, v);
  });
  runtimeFolder.add(guiState, "errorThresholdPx", 0.1, 10).name("Error threshold px").onChange((v: number) => {
    runtimeState.runtimeConfig.selection.errorThresholdPx = v;
  });
  runtimeFolder.add(guiState, "hysteresisMergeFactor", 1.0, 3.0).name("Hysteresis merge factor").onChange((v: number) => {
    runtimeState.runtimeConfig.selection.hysteresisMergeFactor = v;
  });
  runtimeFolder.add(guiState, "neighborMaxLevelDelta", 1, 4, 1).name("Neighbor max level delta").onChange((v: number) => {
    runtimeState.runtimeConfig.selection.neighborLevelDeltaMax = v;
  });
  runtimeFolder.add(guiState, "crossfadeFrames", 0, 60, 1).name("Crossfade frames").onChange((v: number) => {
    runtimeState.runtimeConfig.selection.crossfadeFrames = v;
  });
  runtimeFolder.open();

  const overlayFolder = parent.addFolder("Debug overlays");
  overlayFolder.add(guiState, "showWireframe").name("Wireframe by LOD").onChange((v: boolean) => {
    overlays.setWireframeVisible(v);
  });
  overlayFolder.add(guiState, "showPageBoundaries").name("Page boundaries").onChange((v: boolean) => {
    overlays.setPageBoundariesVisible(v);
  });
  overlayFolder.add(guiState, "showLockedBorderVertices").name("Locked border vertices").onChange((v: boolean) => {
    overlays.setLockedBorderVisible(v);
  });
  overlayFolder.add(guiState, "showErrorLabels").name("Error labels").onChange((v: boolean) => {
    overlays.setErrorLabelsVisible(v);
  });
  overlayFolder.add(guiState, "showStatsPanel").name("Stats panel").onChange((v: boolean) => {
    overlays.setStatsPanelVisible(v);
  });
  overlayFolder.add(guiState, "showNearFieldMask").name("Near-field bubble mask").onChange((v: boolean) => {
    overlays.setNearFieldMaskVisible(v);
  });
  overlayFolder.open();

  const stressFolder = parent.addFolder("Stress scenes");
  stressFolder.add(guiState, "activeStressScene", stressScenes).name("Active scene").onChange((scene: string) => {
    onSceneChange(scene);
  });
  stressFolder.open();

  return guiState;
}
