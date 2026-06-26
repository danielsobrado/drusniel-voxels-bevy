import type { CacheCompressionMode } from "./cacheTypes.js";
import { CacheUnavailableError } from "./cacheErrors.js";

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

export async function compressPayload(
  payload: ArrayBuffer,
  mode: CacheCompressionMode,
): Promise<{ bytes: ArrayBuffer; mode: CacheCompressionMode }> {
  if (mode === "none" || !hasCompressionStream()) {
    if (mode === "gzip" && !hasCompressionStream()) {
      return { bytes: payload, mode: "none" };
    }
    return { bytes: payload, mode: "none" };
  }

  const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  return { bytes: compressed, mode: "gzip" };
}

export async function decompressPayload(
  payload: ArrayBuffer,
  mode: CacheCompressionMode,
): Promise<ArrayBuffer> {
  if (mode === "none") return payload;
  if (!hasCompressionStream()) {
    throw new CacheUnavailableError("gzip decompression unavailable in this environment");
  }
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function resolveCompressionMode(
  requested: CacheCompressionMode,
): CacheCompressionMode {
  if (requested === "gzip" && hasCompressionStream()) return "gzip";
  return "none";
}
