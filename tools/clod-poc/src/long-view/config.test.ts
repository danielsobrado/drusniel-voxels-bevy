import { describe, expect, it } from "vitest";
import { createDefaultLongViewConfig, DEFAULT_LONG_VIEW_CONFIG } from "./longViewConfig.js";

describe("createDefaultLongViewConfig", () => {
  it("returns a fresh config each call", () => {
    const a = createDefaultLongViewConfig();
    const b = createDefaultLongViewConfig();
    expect(a).not.toBe(b);
    expect(a.farShell).not.toBe(b.farShell);
    expect(a.farSummary.rings).not.toBe(b.farSummary.rings);
  });

  it("scene overrides do not mutate DEFAULT_LONG_VIEW_CONFIG", () => {
    const cfg = createDefaultLongViewConfig();
    cfg.farShell.endMeters = 32768;
    cfg.farShell.farFadeMeters = 4096;
    cfg.targetVisibleMeters = 16384;

    expect(DEFAULT_LONG_VIEW_CONFIG.farShell.endMeters).toBe(16384);
    expect(DEFAULT_LONG_VIEW_CONFIG.farShell.farFadeMeters).toBe(2048);
    expect(DEFAULT_LONG_VIEW_CONFIG.targetVisibleMeters).toBe(4096);
  });

  it("nested ring array is independent per call", () => {
    const cfg = createDefaultLongViewConfig();
    cfg.farSummary.rings[0].endM = 9999;
    expect(DEFAULT_LONG_VIEW_CONFIG.farSummary.rings[0].endM).toBe(4096);
  });

  it("default values are consistent", () => {
    const cfg = createDefaultLongViewConfig();
    expect(cfg.farShell.startMeters).toBe(4096);
    expect(cfg.farShell.endMeters).toBe(16384);
    expect(cfg.farShell.rebaseSnapMeters).toBe(64);
    expect(cfg.farSummary.enabled).toBe(true);
    expect(cfg.debug.showMissingSummaryFallback).toBe(false);
  });
});
