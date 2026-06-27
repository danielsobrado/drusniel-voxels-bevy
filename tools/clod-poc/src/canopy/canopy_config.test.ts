import { describe, expect, it } from "vitest";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import {
  applyCanopyShellQueryOverrides,
  parseCanopyShellConfig,
  shouldUseDeterministicCanopy,
  validateCanopyShellConfig,
} from "./canopy_config.js";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";

describe("canopy config", () => {
  it("loads canopy_shell.yaml", () => {
    const cfg = parseCanopyShellConfig(canopyYaml);
    expect(cfg.seed).toBe(12345);
    expect(cfg.distances.shellEndM).toBe(8192);
    expect(cfg.clipmap.rings.length).toBe(3);
  });

  it("rejects invalid distance ordering", () => {
    const bad = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    bad.distances.impostorEndM = 9000;
    expect(() => validateCanopyShellConfig(bad)).toThrow(/impostor_end_m/);
  });

  it("rejects shell start after shell full distance", () => {
    const bad = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    bad.distances.shellStartM = bad.distances.shellFullM + 1;
    expect(() => validateCanopyShellConfig(bad)).toThrow(/shell_start_m/);
  });

  it("rejects non-positive shell and fade distances", () => {
    const badShell = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    badShell.distances.shellEndM = 0;
    expect(() => validateCanopyShellConfig(badShell)).toThrow(/shell_end_m/);

    const badFade = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    badFade.distances.fadeBandM = 0;
    expect(() => validateCanopyShellConfig(badFade)).toThrow(/fade_band_m/);
  });

  it("rejects invalid streaming budgets", () => {
    const badTiles = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    badTiles.budgets.maxTilesBuiltPerFrame = -1;
    expect(() => validateCanopyShellConfig(badTiles)).toThrow(/max_tiles_built_per_frame/);

    const badUploads = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    badUploads.budgets.maxTextureUploadsPerFrame = -1;
    expect(() => validateCanopyShellConfig(badUploads)).toThrow(/max_texture_uploads_per_frame/);

    const badTris = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    badTris.budgets.maxShellTris = 0;
    expect(() => validateCanopyShellConfig(badTris)).toThrow(/max_shell_tris/);
  });

  it("applies query overrides", () => {
    const params = new URLSearchParams("canopy=0&canopySynthetic=1&freezeCanopy=1");
    const next = applyCanopyShellQueryOverrides(DEFAULT_CANOPY_SHELL_CONFIG, params);
    expect(next.enabled).toBe(false);
    expect(next.debug.forceSyntheticSource).toBe(true);
    expect(next.debug.freezeClipCenter).toBe(true);
  });

  it("enables deterministic canopy for forest long-view scene", () => {
    expect(shouldUseDeterministicCanopy("long-view-forest-4km", DEFAULT_CANOPY_SHELL_CONFIG, false)).toBe(true);
    expect(shouldUseDeterministicCanopy("long-view-4km", DEFAULT_CANOPY_SHELL_CONFIG, false)).toBe(false);
    expect(shouldUseDeterministicCanopy("long-view-4km", DEFAULT_CANOPY_SHELL_CONFIG, true)).toBe(true);
  });
});
