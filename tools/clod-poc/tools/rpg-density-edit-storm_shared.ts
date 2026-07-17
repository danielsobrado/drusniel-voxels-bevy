export const EDIT_STORM_REQUIRED_HOOKS = [
  "ready",
  "stats",
  "setPose",
  "settle",
] as const;

export const EDIT_STORM_AUTHORITATIVE_APIS = [
  "runTerrainEditProbe",
  "scheduleDig",
  "destroyEnvironmentalProp",
  "fellTree",
  "placeConstructionPiece",
  "breakConstructionPiece",
] as const;

export type EditStormAuthoritativeApi = (typeof EDIT_STORM_AUTHORITATIVE_APIS)[number];

export interface EditStormApiDiscovery {
  readonly available: readonly string[];
  readonly missing: readonly EditStormAuthoritativeApi[];
  readonly canRunStorm: boolean;
}

export interface LatencySample {
  readonly editClass: string;
  readonly requestToVisibleMs: number | null;
  readonly requestToColliderMs: number | null;
  readonly requestToSummaryMs: number | null;
  readonly requestToDurableMs: number | null;
  readonly stubbed: boolean;
}

export interface FrameStallStats {
  readonly maxFrameMs: number;
  readonly framesOver100Ms: number;
  readonly samples: number;
}

export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

export function summarizeLatency(samples: readonly LatencySample[]): Record<string, number | null> {
  const pick = (key: keyof LatencySample) => {
    const values = samples
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    return {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: values[values.length - 1] ?? 0,
    };
  };
  return {
    requestToVisible_p50: pick("requestToVisibleMs")?.p50 ?? null,
    requestToVisible_p95: pick("requestToVisibleMs")?.p95 ?? null,
    requestToCollider_p50: pick("requestToColliderMs")?.p50 ?? null,
    requestToCollider_p95: pick("requestToColliderMs")?.p95 ?? null,
    requestToSummary_p50: pick("requestToSummaryMs")?.p50 ?? null,
    requestToSummary_p95: pick("requestToSummaryMs")?.p95 ?? null,
    requestToDurable_p50: pick("requestToDurableMs")?.p50 ?? null,
    requestToDurable_p95: pick("requestToDurableMs")?.p95 ?? null,
  };
}

export function discoverEditStormApis(
  clod: Record<string, unknown> | null | undefined,
): EditStormApiDiscovery {
  const available: string[] = [];
  const missing: EditStormAuthoritativeApi[] = [];
  for (const api of EDIT_STORM_AUTHORITATIVE_APIS) {
    if (typeof clod?.[api] === "function") available.push(api);
    else missing.push(api);
  }
  const canRunStorm = EDIT_STORM_REQUIRED_HOOKS.every((hook) => clod?.[hook] !== undefined && clod?.[hook] !== null);
  return { available, missing, canRunStorm };
}

export function summarizeFrameStalls(frameMsSamples: readonly number[], warmupFrames: number): FrameStallStats {
  const postWarmup = frameMsSamples.slice(warmupFrames);
  let maxFrameMs = 0;
  let framesOver100Ms = 0;
  for (const frameMs of postWarmup) {
    if (frameMs > maxFrameMs) maxFrameMs = frameMs;
    if (frameMs > 100) framesOver100Ms += 1;
  }
  return { maxFrameMs, framesOver100Ms, samples: postWarmup.length };
}
