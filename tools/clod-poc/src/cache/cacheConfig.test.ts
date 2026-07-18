import { describe, expect, it } from "vitest";
import cacheConfigText from "../../config/clod_cache.yaml?raw";
import { parseClodCacheConfig } from "./cacheConfig.js";
import { DEFAULT_CACHE_RPC_TIMEOUT_MS } from "./cacheConstants.js";

describe("cache RPC timeout config", () => {
  it("loads a bounded worker RPC timeout", () => {
    expect(parseClodCacheConfig(cacheConfigText).persistent.rpc_timeout_ms).toBe(30_000);
  });

  it("keeps older cache YAML valid with the centralized default", () => {
    const legacy = cacheConfigText.replace("rpc_timeout_ms: 30000", "");
    expect(parseClodCacheConfig(legacy).persistent.rpc_timeout_ms).toBe(DEFAULT_CACHE_RPC_TIMEOUT_MS);
  });

  it("rejects non-positive RPC timeouts", () => {
    expect(() => parseClodCacheConfig(
      cacheConfigText.replace("rpc_timeout_ms: 30000", "rpc_timeout_ms: 0"),
    )).toThrow(/rpc_timeout_ms/);
  });
});
