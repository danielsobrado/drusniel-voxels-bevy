import { describe, expect, it } from "vitest";
import { DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import { createShadowProxyMaterial } from "./shadowProxyMaterial.js";
import { buildShadowProxyMesh } from "./shadowProxyBuilder.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";

describe("shadow proxy material", () => {
  it("normal material is cast-only in the main pass", () => {
    const material = createShadowProxyMaterial(DEFAULT_SHADOW_PROXY_CONFIG);
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
  });

  it("debug visible material can write color", () => {
    const material = createShadowProxyMaterial({
      ...DEFAULT_SHADOW_PROXY_CONFIG,
      debugVisibleProxy: true,
    });
    expect(material.colorWrite).toBe(true);
    expect(material.transparent).toBe(true);
  });

  it("respects shadow side setting", () => {
    const material = createShadowProxyMaterial({
      ...DEFAULT_SHADOW_PROXY_CONFIG,
      shadowSide: "back",
    });
    expect(material.side).toBe(1);
  });
});

describe("shadow proxy runtime", () => {
  it("dispose can be called twice safely", () => {
    const summary = buildTerrainSummary([], 128, 4);
    const runtime = buildShadowProxyMesh(summary, {
      ...DEFAULT_SHADOW_PROXY_CONFIG,
      gridRes: 4,
      startM: 0,
      endM: 128,
    });
    runtime.dispose();
    expect(() => runtime.dispose()).not.toThrow();
  });
});
