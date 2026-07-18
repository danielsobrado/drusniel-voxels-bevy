let streamingEnabled = true;
let streamingGeneration = 0;

const TERRAIN_STREAMING_STATE_MESSAGE = "terrainStreamingState";

export interface TerrainStreamingState {
  readonly enabled: boolean;
  readonly generation: number;
}

export interface TerrainStreamingStateMessage extends TerrainStreamingState {
  readonly type: typeof TERRAIN_STREAMING_STATE_MESSAGE;
}

export interface TerrainStreamingToken {
  readonly generation: number;
  isCurrent(): boolean;
}

export interface TerrainStreamingWorker {
  postMessage(message: TerrainStreamingStateMessage): void;
}

type WorkerReference = { deref(): TerrainStreamingWorker | undefined };

const workerReferences = new Set<WorkerReference>();

function workerRealm(): boolean {
  const constructorName = (globalThis as { constructor?: { name?: string } }).constructor?.name ?? "";
  return typeof window === "undefined" && constructorName.includes("WorkerGlobalScope");
}

function currentState(): TerrainStreamingState {
  return { enabled: streamingEnabled, generation: streamingGeneration };
}

function currentStateMessage(): TerrainStreamingStateMessage {
  return { type: TERRAIN_STREAMING_STATE_MESSAGE, ...currentState() };
}

function parseState(value: unknown): TerrainStreamingState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<TerrainStreamingState>;
  if (typeof state.enabled !== "boolean"
    || !Number.isInteger(state.generation)
    || state.generation! < 0) return null;
  return { enabled: state.enabled, generation: state.generation! };
}

function hasTerrainStreamingStateType(value: unknown): boolean {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === TERRAIN_STREAMING_STATE_MESSAGE;
}

function createWorkerReference(worker: TerrainStreamingWorker): WorkerReference {
  if (typeof WeakRef === "undefined") return { deref: () => worker };
  return new WeakRef(worker);
}

function publishStateToWorkers(): void {
  const message = currentStateMessage();
  for (const reference of workerReferences) {
    const worker = reference.deref();
    if (!worker) {
      workerReferences.delete(reference);
      continue;
    }
    try {
      worker.postMessage(message);
    } catch {
      workerReferences.delete(reference);
    }
  }
}

function installWorkerStateListener(): void {
  if (!workerRealm()) return;
  const target = globalThis as unknown as {
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  };
  target.addEventListener("message", (event) => {
    if (!hasTerrainStreamingStateType(event.data)) return;
    event.stopImmediatePropagation();
    applyTerrainStreamingState(event.data);
  });
}

installWorkerStateListener();

export function registerTerrainStreamingWorker(worker: TerrainStreamingWorker): () => void {
  const reference = createWorkerReference(worker);
  workerReferences.add(reference);
  try {
    worker.postMessage(currentStateMessage());
  } catch (error) {
    workerReferences.delete(reference);
    throw error;
  }
  return () => workerReferences.delete(reference);
}

export function applyTerrainStreamingState(value: unknown): boolean {
  const state = parseState(value);
  if (!state || state.generation < streamingGeneration) return false;
  if (state.generation === streamingGeneration) return state.enabled === streamingEnabled;
  streamingEnabled = state.enabled;
  streamingGeneration = state.generation;
  return true;
}

export function setTerrainStreamingEnabled(enabled: boolean): void {
  if (streamingEnabled === enabled) return;
  streamingEnabled = enabled;
  streamingGeneration++;
  publishStateToWorkers();
}

export function terrainStreamingIsEnabled(): boolean {
  return streamingEnabled;
}

export function terrainStreamingGeneration(): number {
  return streamingGeneration;
}

export function terrainStreamingGenerationIsCurrent(generation: number): boolean {
  return streamingEnabled
    && Number.isInteger(generation)
    && generation === streamingGeneration;
}

export function captureTerrainStreamingToken(): TerrainStreamingToken {
  const generation = streamingGeneration;
  return Object.freeze({
    generation,
    isCurrent: () => terrainStreamingGenerationIsCurrent(generation),
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
  workerReferences.clear();
}
