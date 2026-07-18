import { resolve } from "node:path";
import { clodUrl } from "../launch.js";
import type { PlayableSliceRoutePlan } from "./playable_slice_route_planner.js";

export const PLAYABLE_SLICE_SEED = 1;
export const PLAYABLE_SLICE_WORLD_PAGES = 4;
export const PLAYABLE_SLICE_WIDTH = 1280;
export const PLAYABLE_SLICE_HEIGHT = 720;
export const PLAYABLE_SLICE_READY_TIMEOUT_MS = 180_000;
export const PLAYABLE_SLICE_RUN_TIMEOUT_MS = 240_000;
export const PLAYABLE_SLICE_CONSTRUCTION_STORAGE_KEY = "drusniel.clod-poc.construction.v1";
export const PLAYABLE_SLICE_OUT = resolve("acceptance-runs/playable-slice/report.json");
export const PLAYABLE_SLICE_SHOTS_DIR = resolve("acceptance-runs/playable-slice/shots");

export function playableSliceExtra(saveId?: string): Record<string, string> {
  return {
    acceptance: "1",
    world: String(PLAYABLE_SLICE_WORLD_PAGES),
    hud: "1",
    liveBubble: "1",
    liveBubbleRadius: "200",
    liveBubbleColliderRadius: "160",
    liveClodRootRadius: "384",
    farClipmap: "1",
    farClipmapMode: "replace",
    ...(saveId ? { save: saveId } : {}),
  };
}

export function playableSliceDiscoveryUrl(): string {
  return clodUrl({
    scene: "continent",
    seed: PLAYABLE_SLICE_SEED,
    hud: true,
    extra: playableSliceExtra(),
  });
}

export function playableSliceSetupUrl(): string {
  return clodUrl({
    scene: "continent",
    seed: PLAYABLE_SLICE_SEED,
    extra: playableSliceExtra(),
  });
}

export function playableSliceGameplayUrl(saveId: string, plan: PlayableSliceRoutePlan): string {
  return clodUrl({
    scene: "continent",
    seed: PLAYABLE_SLICE_SEED,
    hud: true,
    extra: {
      ...playableSliceExtra(saveId),
      x: String(plan.spawn[0]),
      z: String(plan.spawn[1]),
      yaw: String(plan.yaw),
    },
  });
}
