export const DEFAULT_PLAYABLE_SLICE_RUNS = 5;
export const MAX_PLAYABLE_SLICE_RUNS = 100;

export type PlayableSliceConfiguredMode = "diagnostic" | "continuous";

export interface PlayableSliceAcceptanceConfig {
  readonly runs: number;
  readonly modes: readonly PlayableSliceConfiguredMode[];
}

function optionValue(args: readonly string[], prefix: string): string | null {
  const values = args.filter((value) => value.startsWith(prefix));
  if (values.length > 1) throw new Error(`duplicate acceptance option: ${prefix.slice(0, -1)}`);
  return values[0]?.slice(prefix.length) ?? null;
}

export function parsePlayableSliceAcceptanceConfig(
  args: readonly string[],
): PlayableSliceAcceptanceConfig {
  const known = args.filter((value) => value.startsWith("--runs=") || value.startsWith("--mode="));
  if (known.length !== args.length) {
    const unknown = args.find((value) => !value.startsWith("--runs=") && !value.startsWith("--mode="));
    throw new Error(`unknown playable-slice option: ${unknown}`);
  }

  const rawRuns = optionValue(args, "--runs=");
  const runs = rawRuns === null ? DEFAULT_PLAYABLE_SLICE_RUNS : Number(rawRuns);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_PLAYABLE_SLICE_RUNS) {
    throw new Error(`--runs must be an integer from 1 to ${MAX_PLAYABLE_SLICE_RUNS}`);
  }

  const rawMode = optionValue(args, "--mode=");
  if (rawMode === null) return { runs, modes: ["diagnostic", "continuous"] };
  if (rawMode !== "diagnostic" && rawMode !== "continuous") {
    throw new Error("--mode must be diagnostic or continuous");
  }
  return { runs, modes: [rawMode] };
}
