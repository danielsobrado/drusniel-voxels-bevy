import type { Phase0StreamingConfig } from "../phase0/phase0_config.js";
import { resolveStreamingOwnership, type StreamingOwnershipRadii } from "./streaming_ownership.js";

export interface MutableShellRange {
  startMeters: number;
  endMeters: number;
}

export interface ResolveShellOwnershipInput {
  streaming: Phase0StreamingConfig;
  targetVisibleM: number;
  targetFutureVisibleM: number;
  streamingScene: boolean;
}

export function resolveShellOwnership(input: ResolveShellOwnershipInput): StreamingOwnershipRadii {
  return resolveStreamingOwnership({
    streaming: input.streaming,
    targetVisibleM: input.targetVisibleM,
    targetFutureVisibleM: input.targetFutureVisibleM,
    streamingScene: input.streamingScene,
  });
}

export function applyShellOwnershipRange(
  shell: MutableShellRange,
  ownership: StreamingOwnershipRadii,
): void {
  if (!ownership.streamingScene) return;
  shell.startMeters = ownership.farShellInnerM;
  shell.endMeters = Math.max(shell.endMeters, ownership.farShellOuterM);
}
