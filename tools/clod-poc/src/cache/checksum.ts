import { CacheUnavailableError } from "./cacheErrors.js";

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new CacheUnavailableError("Web Crypto subtle API unavailable; cannot compute cache checksum");
  }
  const digest = await cryptoObj.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out.buffer;
}
