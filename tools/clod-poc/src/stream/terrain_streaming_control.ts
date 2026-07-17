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

let stateChannel: BroadcastChannel | null = null;

function workerRealm(): boolean {
  return typeof window === "undefined"
    && typeof WorkerGlobalScope !== "undefined"
    && globalThis instanceof WorkerGlobalScope;
}

function currentState(): TerrainStreamingState {
  return { enabled: streamingEnabled, generation: streamingGeneration };
}

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!stateChannel) stateChannel = new BroadcastChannel(STREAMING_CHANNEL_NAME);
  return stateChannel;
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

if (workerRealm()) {
  const workerChannel = channel();
  if (workerChannel) workerChannel.onmessage = (event) => applyRemoteState(event.data);
}

export function setTerrainStreamingEnabled(enabled: boolean): void {
  if (streamingEnabled === enabled) return;
  streamingEnabled = enabled;
  streamingGeneration++;
  if (typeof window !== "undefined") channel()?.postMessage(currentState());
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
