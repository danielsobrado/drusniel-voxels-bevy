import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";
import { createDefaultLongViewConfig } from "../../long-view/index.js";
import { isNaadfScene, type NaadfIntegration } from "../../naadf/integration.js";

export type LongViewConfig = ReturnType<typeof createDefaultLongViewConfig>;

export function farSummaryCanopyEnabled(params: URLSearchParams): boolean {
  return params.get("farSummaryCanopy") !== "0";
}

export function isLongViewCapableScene(queryScene: string | null): boolean {
  return queryScene === "infinite-stream-far-summary"
    || queryScene === "infinite-stream-slow-builds"
    || queryScene === "infinite-islands"
    || queryScene === "continent"
    || queryScene === "infinite-stream-straight"
    || queryScene === "infinite-stream-fast-turn"
    || queryScene === "long-view-4km"
    || queryScene === "long-view-8km"
    || queryScene === "long-view-16km"
    || queryScene === "long-view-forest-4km"
    || queryScene === "long-view-edit-stress"
    || queryScene === RIVER_PARITY_TEST_SCENE
    || queryScene === "infinite-far-shell-straight"
    || queryScene === "infinite-far-shell-fast-turn"
    || queryScene === "infinite-far-shell-mountain-approach"
    || isNaadfScene(queryScene);
}

export function applyLongViewScenePreset(
  config: LongViewConfig,
  queryScene: string | null,
  naadfIntegration: NaadfIntegration | undefined,
): void {
  if (
    queryScene === "long-view-8km"
    || queryScene === "infinite-far-shell-straight"
    || queryScene === "infinite-far-shell-fast-turn"
    || queryScene === "infinite-far-shell-mountain-approach"
  ) {
    config.targetVisibleMeters = 8192;
    config.farShell.endMeters = 16384;
  } else if (queryScene === "long-view-16km") {
    config.targetVisibleMeters = 16384;
    config.farShell.endMeters = 32768;
    config.farShell.farFadeMeters = 4096;
  }

  if (naadfIntegration && (queryScene?.startsWith("infinite-naadf-") ?? false)) {
    config.farShell.startMeters = naadfIntegration.config.farShell.startM;
    config.farShell.endMeters = naadfIntegration.config.farShell.endM;
    if (naadfIntegration.config.farShell.gridRes > 0) {
      config.farShell.radialSegments = naadfIntegration.config.farShell.gridRes;
      config.farShell.angularSegments = naadfIntegration.config.farShell.gridRes;
    }
  }
}
