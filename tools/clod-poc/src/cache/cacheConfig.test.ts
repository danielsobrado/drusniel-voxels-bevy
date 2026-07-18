import { describe, expect, it } from "vitest";
import cacheConfigText from "../../config/clod_cache.yaml?raw";
import { parseClodCacheConfig } from "./cacheConfig.js";

describe("cache RPC timeout config", () => {
  it("loads a bounded worker RPC timeout", () => {
    expect(parseClodCacheConfig(cacheConfigText).persistent.rpc_timeout_ms).toBe(30_000);
  });

  it("rejects missing or non-positive RPC timeouts", () => {
    expect(() => parseClodCacheConfig(cacheConfigText.replace("rpc_timeout_ms: 30000", "")))
      .toThrow(/rpc_timeout_ms/);
    expect(() => parseClodCacheConfig(cacheConfigText.replace("rpc_timeout_ms: 30000", "rpc_timeout_ms: 0")))
      .toThrow(/rpc_timeout_ms/);
  });
});
