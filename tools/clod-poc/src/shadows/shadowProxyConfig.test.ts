import { describe, expect, it, vi } from "vitest";
import longViewYaml from "../../config/long_view.yaml?raw";
import {
  applyShadowProxyDebugQueryOverrides,
  applyShadowProxySceneOverrides,
  DEFAULT_SHADOW_PROXY_CONFIG,
  parseLongViewSunShadowsConfig,
  resolveShadowProxyRebuildSnapMeters,
} from "./shadowProxyConfig.js";
import { DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG } from "../config/longViewDefaults.js";

describe("shadow proxy config", () => {
  it("loads defaults from config/long_view.yaml", () => {
    const parsed = parseLongViewSunShadowsConfig(longViewYaml);
    expect(parsed.shadowProxy.gridRes).toBe(512);
    expect(parsed.shadowProxy.startM).toBe(192);
    expect(parsed.shadowProxy.endM).toBe(4096);
    expect(parsed.enabled).toBe(true);
  });

  it("keeps positive grid resolution and valid start/end distances", () => {
    expect(DEFAULT_SHADOW_PROXY_CONFIG.gridRes).toBeGreaterThan(0);
    expect(DEFAULT_SHADOW_PROXY_CONFIG.startM).toBeLessThan(DEFAULT_SHADOW_PROXY_CONFIG.endM);
  });

  it("defaults cast-only main pass flags to false", () => {
    expect(DEFAULT_SHADOW_PROXY_CONFIG.mainPassColorWrite).toBe(false);
    expect(DEFAULT_SHADOW_PROXY_CONFIG.mainPassDepthWrite).toBe(false);
  });

  it("applies debug query overrides only for debug flags and enable toggle", () => {
    const params = new URLSearchParams("shadowProxyDebugVisible=1&shadowProxy=0");
    const next = applyShadowProxyDebugQueryOverrides(DEFAULT_SHADOW_PROXY_CONFIG, params);
    expect(next.debugVisibleProxy).toBe(true);
    expect(next.enabled).toBe(false);
    expect(next.gridRes).toBe(DEFAULT_SHADOW_PROXY_CONFIG.gridRes);
  });

  it("applies scene presets", () => {
    const off = applyShadowProxySceneOverrides(DEFAULT_SHADOW_PROXY_CONFIG, "long-view-shadow-proxy-off");
    expect(off.enabled).toBe(false);
    const debug = applyShadowProxySceneOverrides(DEFAULT_SHADOW_PROXY_CONFIG, "long-view-shadow-proxy-debug-visible");
    expect(debug.debugVisibleProxy).toBe(true);
  });

  it("falls back to defaults for empty yaml", () => {
    expect(parseLongViewSunShadowsConfig("")).toEqual(DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG);
  });

  it("falls back to defaults for malformed yaml", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseLongViewSunShadowsConfig("long_view:\n  shadow_proxy: [");
    expect(parsed).toEqual(DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("uses coarse rebuild snap for large proxy extent", () => {
    expect(resolveShadowProxyRebuildSnapMeters(DEFAULT_SHADOW_PROXY_CONFIG)).toBe(1024);
    expect(resolveShadowProxyRebuildSnapMeters({ ...DEFAULT_SHADOW_PROXY_CONFIG, endM: 800 })).toBe(512);
  });
});
