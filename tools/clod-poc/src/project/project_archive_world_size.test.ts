import { describe, expect, it } from "vitest";
import { resolveProjectArchiveWorldPages } from "./project_archive_world_size.js";

describe("project archive world size", () => {
  it("prefers the configured domain over the startup bubble", () => {
    expect(resolveProjectArchiveWorldPages(4, 16, 8)).toBe(16);
  });

  it("uses canonical world-mode diagnostics before the startup fallback", () => {
    expect(resolveProjectArchiveWorldPages(4, undefined, 32)).toBe(32);
  });

  it("fails when no valid world size exists", () => {
    expect(() => resolveProjectArchiveWorldPages(0, Number.NaN, -1)).toThrow(/world size is invalid/i);
  });
});
