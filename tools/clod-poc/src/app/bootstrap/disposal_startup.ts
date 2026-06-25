import { bindUiAudioShell } from "../ui_audio_shell.js";
import type { UiStartupContext } from "./ui_startup_context.js";

export function bindBootstrapDisposal(ctx: UiStartupContext): void {
  const { input } = ctx;
  const {
    clodWorker,
    getClodErrorCompute,
    runtime: {
      grassSystem,
      forestLightingController,
      treeController,
      stoneSystem,
      waterController,
      weatherController,
    },
    terrainView: {
      nearFieldBubbleController,
      lockedBorderOverlay,
      skyEnvironment,
      postProcess,
      farShellController,
      shadowProxyResult,
    },
  } = input;

  bindUiAudioShell();

  window.addEventListener("beforeunload", () => {
    nearFieldBubbleController.dispose();
    lockedBorderOverlay.dispose();
    grassSystem.dispose();
    forestLightingController.dispose();
    treeController.dispose();
    stoneSystem.dispose();
    waterController.dispose();
    weatherController.dispose();
    skyEnvironment?.dispose();
    postProcess?.dispose();
    getClodErrorCompute()?.destroy();
    clodWorker.dispose();
    farShellController.dispose();
    shadowProxyResult.dispose();
  }, { once: true });
}
