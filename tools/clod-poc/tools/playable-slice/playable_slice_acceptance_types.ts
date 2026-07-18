import type { ContinentRiverCrossingRoute } from "../../src/water/continent_river_route.js";
import type { WorldManifest } from "../../src/world/world_manifest.js";
import type { HeadedWebGpuProbe } from "./headed_real_webgpu.js";
import type { PlayableSliceMode, PlayableSliceRunReport } from "./playable_slice_contract.js";
import type { PlayableSliceRoutePlan } from "./playable_slice_route_planner.js";

export interface PlayableSliceDiscoveryResult {
  readonly route: ContinentRiverCrossingRoute;
  readonly plan: PlayableSliceRoutePlan;
  readonly worldManifest: WorldManifest;
}

export interface PlayableSliceAcceptanceReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly scene: "continent";
  readonly seed: number;
  readonly configuredRuns: number;
  readonly configuredModes: readonly PlayableSliceMode[];
  readonly expectedRunCount: number;
  readonly gpu: HeadedWebGpuProbe | null;
  readonly route: PlayableSliceDiscoveryResult | null;
  readonly runs: readonly PlayableSliceRunReport[];
  readonly passed: boolean;
  readonly failures: readonly string[];
}
