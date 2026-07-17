let streamingEnabled = true;
let streamingGeneration = 0;

const STREAMING_CHANNEL_NAME = "drusniel-terrain-streaming-control-v1";

export interface TerrainStreamingState {
  readonly enabled: boolean;
  readonly generation: number;
}

export interface TerrainStreamingToken {
  readonly generation: number;
  isCurrent(): boolean;
}

function workerRealm(): boolean {
  const constructorName = (globalThis as { constructor?: { name?: string } }).constructor?.name ?? "";
  return typeof window === "undefined" && constructorName.includes("WorkerGlobalScope");
}

function currentState(): TerrainStreamingState {
  return { enabled: streamingEnabled, generation: streamingGeneration };
}

function applyRemoteState(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const state = value as Partial<TerrainStreamingState>;
  if (typeof state.enabled !== "boolean"
    || !Number.isInteger(state.generation)
    || state.generation! < streamingGeneration) return;
  streamingEnabled = state.enabled;
  streamingGeneration = state.generation!;
}

function broadcastState(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const sender = new BroadcastChannel(STREAMING_CHANNEL_NAME);
  sender.postMessage(currentState());
  sender.close();
}

if (workerRealm() && typeof BroadcastChannel !== "undefined") {
  const workerChannel = new BroadcastChannel(STREAMING_CHANNEL_NAME);
  workerChannel.onmessage = (event) => applyRemoteState(event.data);
}

export function setTerrainStreamingEnabled(enabled: boolean): void {
  if (streamingEnabled === enabled) return;
  streamingEnabled = enabled;
  streamingGeneration++;
  if (typeof window !== "undefined") broadcastState();
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
