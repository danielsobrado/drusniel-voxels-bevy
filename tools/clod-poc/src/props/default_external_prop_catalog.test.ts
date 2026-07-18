import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDefaultExternalPropCatalog } from "./default_external_prop_catalog.js";
import { DEFAULT_CUSTOM_PROPS_SETTINGS } from "./prop_config.js";

describe("loadDefaultExternalPropCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects SPA HTML fallback instead of silently loading empty props", async () => {
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:5180/" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const next = await loadDefaultExternalPropCatalog({ ...DEFAULT_CUSTOM_PROPS_SETTINGS, props: [] });
    expect(next.props).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toMatch(/SPA-fallback HTML|catalog missing/);
  });

  it("loads JSON catalogs", async () => {
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:5180/" } });
    const catalog = {
      packId: "quaternius-construction",
      props: [{ id: "chest_closed", source: "chest_closed.glb", category: "interactive" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalog), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const next = await loadDefaultExternalPropCatalog({ ...DEFAULT_CUSTOM_PROPS_SETTINGS, props: [] });
    expect(next.props).toHaveLength(1);
    expect(next.props[0]?.id).toContain("chest_closed");
    expect(info).toHaveBeenCalled();
  });
});
