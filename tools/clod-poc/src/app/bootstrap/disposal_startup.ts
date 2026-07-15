import { bindUiAudioShell } from "../ui_audio_shell.js";
import type { UiStartupContext } from "./ui_startup_context.js";

export function bindBootstrapDisposal(ctx: UiStartupContext): void {
  const { input, session } = ctx;
  const {
    renderer,
    clodWorker,
    getClodErrorCompute,
    runtime: {
      grassSystem,
      forestLightingController,
      treeController,
      dressingSystem,
      stoneSystem,
      waterController,
      weatherController,
      customProps,
    },
    terrainView: {
      nearFieldBubbleController,
      renderNodeCache,
      pageGeometryCache,
      lockedBorderOverlay,
      skyEnvironment,
      postProcess,
      farShellController,
      shadowProxyController,
    },
    longView,
  } = input;

  bindUiAudioShell();

  window.addEventListener("beforeunload", () => {
    session.frameLoopAbortController?.abort();
    renderer.setAnimationLoop(null);
    nearFieldBubbleController.dispose();
    renderNodeCache.dispose();
    pageGeometryCache.dispose();
    lockedBorderOverlay.dispose();
    grassSystem.dispose();
    forestLightingController.dispose();
    treeController.dispose();
    dressingSystem.dispose();
    stoneSystem.dispose();
    waterController.dispose();
    weatherController.dispose();
    customProps?.stopPropStoreSync();
    customProps?.propController.dispose();
    skyEnvironment?.dispose();
    postProcess?.dispose();
    getClodErrorCompute()?.destroy();
    clodWorker.dispose();
    farShellController.dispose();
    shadowProxyController?.dispose();
    longView.infiniteFarShell?.dispose();
  }, { once: true });
}
