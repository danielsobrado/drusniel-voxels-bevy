let streamingEnabled = true;
let streamingGeneration = 0;

export interface TerrainStreamingToken {
  readonly generation: number;
  isCurrent(): boolean;
}

export function setTerrainStreamingEnabled(enabled: boolean): void {
  if (streamingEnabled === enabled) return;
  streamingEnabled = enabled;
  streamingGeneration++;
}

export function terrainStreamingIsEnabled(): boolean {
  return streamingEnabled;
}

export function terrainStreamingGeneration(): number {
  return streamingGeneration;
}

export function captureTerrainStreamingToken(): TerrainStreamingToken {
  const generation = streamingGeneration;
  return Object.freeze({
    generation,
    isCurrent: () => streamingEnabled && streamingGeneration === generation,
  });
}

export function runTerrainStreamingWork<T>(
  enabled: boolean,
  work: () => T,
): T | undefined {
  setTerrainStreamingEnabled(enabled);
  return enabled ? work() : undefined;
}

export function resetTerrainStreamingControlForTests(enabled = true): void {
  streamingEnabled = enabled;
  streamingGeneration = 0;
}
