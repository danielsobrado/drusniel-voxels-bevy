import { describe, expect, it } from "vitest";
import { shadowProxyStatsToCounters } from "./shadowProxyStats.js";
import { createEmptyShadowProxyStats } from "./shadowProxyStats.js";

describe("shadow proxy stats counters", () => {
  it("marks proxy inactive when sun shadows are disabled", () => {
    const stats = { ...createEmptyShadowProxyStats(), built: true, enabled: true, gridRes: 8, triangleCount: 10 };
    const counters = shadowProxyStatsToCounters({
      proxyEnabled: true,
      sunShadowsEnabled: false,
      stats,
      lightShadowMapSize: 2048,
      lightShadowCameraExtentM: 4096,
    });
    expect(counters.shadow_proxy_enabled).toBe(1);
    expect(counters.shadow_proxy_inert).toBe(1);
  });

  it("marks proxy active when built with sun shadows on", () => {
    const stats = { ...createEmptyShadowProxyStats(), built: true, enabled: true, gridRes: 8, triangleCount: 10 };
    const counters = shadowProxyStatsToCounters({
      proxyEnabled: true,
      sunShadowsEnabled: true,
      stats,
      lightShadowMapSize: 2048,
      lightShadowCameraExtentM: 4096,
    });
    expect(counters.shadow_proxy_inert).toBe(0);
  });
});
