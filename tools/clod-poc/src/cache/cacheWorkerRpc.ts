import type { ClodCacheStoredRecord } from "./cacheTypes.js";

export type CacheRpcRequest =
  | { type: "cacheRpc"; requestId: number; op: "probe" }
  | { type: "cacheRpc"; requestId: number; op: "get"; key: string }
  | { type: "cacheRpc"; requestId: number; op: "put"; key: string; record: ClodCacheStoredRecord }
  | { type: "cacheRpc"; requestId: number; op: "delete"; key: string }
  | { type: "cacheRpc"; requestId: number; op: "clear" }
  | { type: "cacheRpc"; requestId: number; op: "keys" };

export type CacheRpcResponse =
  | { type: "cacheRpc"; requestId: number; ok: true; result?: unknown }
  | { type: "cacheRpc"; requestId: number; ok: false; error: string };

export function isCacheRpcRequest(value: unknown): value is CacheRpcRequest {
  return typeof value === "object"
    && value !== null
    && (value as CacheRpcRequest).type === "cacheRpc"
    && "op" in value;
}

export function isCacheRpcResponse(value: unknown): value is CacheRpcResponse {
  return typeof value === "object"
    && value !== null
    && (value as CacheRpcResponse).type === "cacheRpc"
    && "ok" in value;
}

export function isCacheRpcMessage(value: unknown): boolean {
  return isCacheRpcRequest(value) || isCacheRpcResponse(value);
}
