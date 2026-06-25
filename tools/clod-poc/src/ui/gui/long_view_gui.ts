import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import type { InfiniteFarShell } from "../../long-view/infiniteFarShell.js";
import type { FarSummaryIntegration } from "../../far-summary/integration.js";

export interface LongViewGuiDeps {
  state: ClodAppState;
  farSummaryIntegration?: FarSummaryIntegration;
  infiniteFarShell?: InfiniteFarShell;
}

export function createLongViewGui(
  gui: GUI,
  deps: LongViewGuiDeps,
): void {
  const { state, farSummaryIntegration, infiniteFarShell } = deps;

  const longViewFolder = gui.addFolder("Long View");
  longViewFolder.close();

  const infiniteShellFolder = longViewFolder.addFolder("Infinite Far Shell");
  infiniteShellFolder.add(state, "longViewInfiniteShellEnabled").name("Enabled").onChange((on: boolean) => {
    if (infiniteFarShell) {
      infiniteFarShell.mesh.visible = on;
    }
  });
  infiniteShellFolder.add(state, "longViewInfiniteShellWireframe").name("Wireframe").onChange((on: boolean) => {
    infiniteFarShell?.setDebugShowWireframe(on);
  });
  infiniteShellFolder.add(state, "longViewShowShellRings").name("Show Rings");
  infiniteShellFolder.add(state, "longViewShowMissingSummaryFallback").name("Show Missing Fallback").onChange((on: boolean) => {
    infiniteFarShell?.setDebugShowMissingFallback(on);
  });

  const farSummaryFolder = longViewFolder.addFolder("Far Summary");
  farSummaryFolder.add(state, "longViewShowFarSummaryTiles").name("Show Tiles");
  farSummaryFolder.add(state, "longViewFreezeStreamCenter").name("Freeze Stream Center");
  farSummaryFolder.add(state, "longViewForceMissingTiles").name("Force Missing Tiles");
  farSummaryFolder.add(state, "longViewRebuildBudget", 1, 16, 1).name("Rebuild Budget").onChange((_val: number) => {
    farSummaryIntegration?.setBuildDelayMs(0);
  });
}
