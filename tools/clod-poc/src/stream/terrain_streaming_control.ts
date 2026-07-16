export function runTerrainStreamingWork<T>(
  enabled: boolean,
  work: () => T,
): T | undefined {
  return enabled ? work() : undefined;
}
