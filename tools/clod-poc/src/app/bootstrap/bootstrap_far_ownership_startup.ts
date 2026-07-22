import { resolveStreamingOwnership, type StreamingOwnershipRadii } from "../../streaming/streaming_ownership.js";
import { assertLegacyFarShellExclusive, buildFarOwnershipSummary } from "../far_ownership.js";
import { farClipmapRendererAllowed } from "../../terrain/far_clipmap/far_clipmap_config.js";
import { isLongViewCapableScene, isStreamingLongViewScene } from "./bootstrap_long_view.js";
import type { WorldModeConfig } from "../world_mode.js";
import type { Phase0Config, Phase0StreamingConfig } from "../../phase0/phase0_config.js";

export interface BootstrapFarOwnershipStartupInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  phase0Streaming: Phase0StreamingConfig;
  phase0TargetVisibleM: number;
  phase0Config: Phase0Config;
  pageSizeM: number;
  farOwner: WorldModeConfig["farOwner"];
}

export interface BootstrapFarOwnershipStartupResult {
  streamingOwnership: StreamingOwnershipRadii;
  farClipmapReplaceActive: boolean;
}

export function runBootstrapFarOwnershipStartup(
  input: BootstrapFarOwnershipStartupInput,
): BootstrapFarOwnershipStartupResult {
  const {
    searchParams,
    queryScene,
    phase0Streaming,
    phase0TargetVisibleM,
    phase0Config,
    pageSizeM,
    farOwner,
  } = input;

  const streamingOwnership = resolveStreamingOwnership({
    streaming: phase0Streaming,
    targetVisibleM: phase0TargetVisibleM,
    targetFutureVisibleM: phase0Config.phase0.target_future_visible_m,
    pageSizeM,
    streamingScene: isStreamingLongViewScene(queryScene),
  });

  // farClipmapMode=replace hands the whole far band to the GPU clipmap, which then becomes the
  // sole far-terrain owner: the player-centred InfiniteFarShell is kept out of the scene so the two
  // do not z-fight or disagree on height across the mid-far band.
  const farClipmapReplaceActive = searchParams.get("farClipmap") === "1" && farClipmapRendererAllowed(searchParams);
  const farRendererActivity = {
    legacyFarShell: farOwner === "legacy_far_shell",
    infiniteFarShell: isLongViewCapableScene(queryScene) && !farClipmapReplaceActive,
    farClipmap: farClipmapReplaceActive,
  };
  assertLegacyFarShellExclusive(farRendererActivity);
  window.__drusnielFarOwnership = buildFarOwnershipSummary({
    farOwner,
    streamingScene: streamingOwnership.streamingScene,
    activity: farRendererActivity,
    clodRadiusM: streamingOwnership.clodRadiusM,
    farInnerM: streamingOwnership.farShellInnerM,
    farOuterM: streamingOwnership.farShellOuterM,
  });

  return { streamingOwnership, farClipmapReplaceActive };
}

declare global {
  interface Window {
    __drusnielFarOwnership?: ReturnType<typeof buildFarOwnershipSummary>;
  }
}
