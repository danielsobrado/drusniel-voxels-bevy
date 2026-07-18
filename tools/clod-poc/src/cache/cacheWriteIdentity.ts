const CACHE_WRITE_SESSION_ID = createCacheWriteSessionId();
let nextCacheWriteSequence = 1;

function createCacheWriteSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    cryptoApi.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36)).join("-");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function nextCacheWriteId(): string {
  return `${CACHE_WRITE_SESSION_ID}:${nextCacheWriteSequence++}`;
}
