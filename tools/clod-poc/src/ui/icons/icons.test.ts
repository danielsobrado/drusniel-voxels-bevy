import { describe, expect, it, vi } from "vitest";
import { iconDataUrl } from "./index";

describe("CLOD painted icons", () => {
  it("returns a PNG data URL", () => {
    expect(iconDataUrl("lod", "page")).toMatch(/^data:image\/png;base64,/);
  });

  it("caches the same kind/id/size result", () => {
    expect(iconDataUrl("lod", "page", 64)).toBe(iconDataUrl("lod", "page", 64));
  });

  it("returns a fallback data URL for unknown icons", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(iconDataUrl("system", "missing-icon")).toMatch(/^data:image\/png;base64,/);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
