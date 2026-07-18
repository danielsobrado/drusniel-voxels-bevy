import { isCacheRpcMessage } from "./cache/cacheWorkerRpc.js";

interface ProtocolWorker {
  addEventListener(type: "message" | "messageerror", listener: (event: MessageEvent) => void): void;
  onerror?: ((event: ErrorEvent) => unknown) | null;
}

const installedWorkers = new WeakSet<object>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableRequestId(value: unknown): value is number | null {
  return value === null || isRequestId(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRequestIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isRequestId);
}

export function isClodWorkerProtocolMessage(value: unknown): boolean {
  if (isCacheRpcMessage(value)) return true;
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "progress":
      return isRequestId(value.requestId);
    case "buildComplete":
      return isRequestId(value.requestId) && isRecord(value.result);
    case "lod0Rebuilt":
      return isRequestIdArray(value.requestIds) && Array.isArray(value.changed);
    case "parentRebuilt":
      return isNullableRequestId(value.requestId) && Array.isArray(value.changed);
    case "parentsComplete":
      return isNullableRequestId(value.requestId)
        && isFiniteNumber(value.parentNodes)
        && isFiniteNumber(value.parentMs);
    case "flushed":
    case "cacheCleared":
      return isRequestId(value.requestId);
    case "streamRootsBuilt":
      return isRequestId(value.requestId)
        && Array.isArray(value.nodes)
        && isFiniteNumber(value.buildMs)
        && isFiniteNumber(value.transferBytes);
    case "heightfieldTilesBuilt":
      return isRequestId(value.requestId)
        && Array.isArray(value.tiles)
        && isFiniteNumber(value.buildMs);
    case "error":
      return isNullableRequestId(value.requestId) && typeof value.message === "string";
    default:
      return false;
  }
}

function createProtocolErrorEvent(message: string): ErrorEvent {
  if (typeof ErrorEvent === "function") return new ErrorEvent("error", { message });
  return { message } as ErrorEvent;
}

function reportProtocolFailure(worker: ProtocolWorker, message: string): void {
  const handler = worker.onerror;
  if (typeof handler !== "function") throw new Error(message);
  handler.call(worker, createProtocolErrorEvent(message));
}

export function installClodWorkerProtocolGuard(workerValue: object): void {
  if (installedWorkers.has(workerValue)) return;
  const worker = workerValue as ProtocolWorker;
  if (typeof worker.addEventListener !== "function") {
    throw new Error("CLOD worker protocol guard requires addEventListener");
  }

  worker.addEventListener("message", (event) => {
    if (isClodWorkerProtocolMessage(event.data)) return;
    reportProtocolFailure(worker, "CLOD worker returned an invalid protocol message");
  });
  worker.addEventListener("messageerror", () => {
    reportProtocolFailure(worker, "CLOD worker message could not be deserialized");
  });
  installedWorkers.add(workerValue);
}
