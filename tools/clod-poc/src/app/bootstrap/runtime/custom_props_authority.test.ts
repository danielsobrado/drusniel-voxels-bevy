import { describe, expect, it } from "vitest";
import { shouldRestoreDefaultCustomProps } from "./custom_props_authority.js";

describe("custom props save authority", () => {
  it("does not restore default props when saved prop authority is loaded but projects zero active props", () => {
    expect(shouldRestoreDefaultCustomProps({
      hasImportedProps: false,
      hasProjectProps: false,
      hasLoadedSavePropAuthority: true,
    })).toBe(false);
  });

  it("restores default props only when no imported, project, or save authority props exist", () => {
    expect(shouldRestoreDefaultCustomProps({
      hasImportedProps: false,
      hasProjectProps: false,
      hasLoadedSavePropAuthority: false,
    })).toBe(true);
    expect(shouldRestoreDefaultCustomProps({
      hasImportedProps: true,
      hasProjectProps: false,
      hasLoadedSavePropAuthority: false,
    })).toBe(false);
    expect(shouldRestoreDefaultCustomProps({
      hasImportedProps: false,
      hasProjectProps: true,
      hasLoadedSavePropAuthority: false,
    })).toBe(false);
  });
});

