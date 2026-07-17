import { describe, expect, it } from "vitest";
import { parsePostFxStageFlags, stageAllowed } from "./postfx_stage_flags.js";

describe("postfx stage flags", () => {
  it("enables every stage by default", () => {
    const flags = parsePostFxStageFlags("");
    expect(flags.postMin).toBe(false);
    expect(stageAllowed(flags, "bloom")).toBe(true);
    expect(stageAllowed(flags, "taa")).toBe(true);
    expect(stageAllowed(flags, "gtao")).toBe(true);
    expect(stageAllowed(flags, "froxels")).toBe(true);
    expect(stageAllowed(flags, "godrays")).toBe(true);
  });

  it("ablates the god-rays stage by name and aliases", () => {
    for (const token of ["godrays", "god-rays", "shafts", "light-shafts"]) {
      const flags = parsePostFxStageFlags(`?ablate=${token}`);
      expect(stageAllowed(flags, "godrays")).toBe(false);
      expect(stageAllowed(flags, "bloom")).toBe(true);
    }
  });

  it("ablates comma-separated stage names and aliases", () => {
    const flags = parsePostFxStageFlags("?ablate=bloom,traa,ao,contactShadows,color-bounce,froxels");
    expect(stageAllowed(flags, "bloom")).toBe(false);
    expect(stageAllowed(flags, "taa")).toBe(false);
    expect(stageAllowed(flags, "gtao")).toBe(false);
    expect(stageAllowed(flags, "contact")).toBe(false);
    expect(stageAllowed(flags, "bounce")).toBe(false);
    expect(stageAllowed(flags, "froxels")).toBe(false);
    expect(stageAllowed(flags, "aerial")).toBe(true);
  });

  it("supports whitespace and plus separated ablation lists", () => {
    const flags = parsePostFxStageFlags("ablate=aerial+autoExposure colorScript volumetric-fog");
    expect(stageAllowed(flags, "aerial")).toBe(false);
    expect(stageAllowed(flags, "autoExposure")).toBe(false);
    expect(stageAllowed(flags, "colorScript")).toBe(false);
    expect(stageAllowed(flags, "froxels")).toBe(false);
    expect(stageAllowed(flags, "bloom")).toBe(true);
  });

  it("postmin disables all optional stages but keeps color script unless ablated", () => {
    const flags = parsePostFxStageFlags("?postmin=1");
    expect(flags.postMin).toBe(true);
    expect(stageAllowed(flags, "bloom")).toBe(false);
    expect(stageAllowed(flags, "taa")).toBe(false);
    expect(stageAllowed(flags, "aerial")).toBe(false);
    expect(stageAllowed(flags, "gtao")).toBe(false);
    expect(stageAllowed(flags, "froxels")).toBe(false);
    expect(stageAllowed(flags, "colorScript")).toBe(true);
  });

  it("postmin can also remove color script", () => {
    const flags = parsePostFxStageFlags("?postmin=1&ablate=grade");
    expect(stageAllowed(flags, "colorScript")).toBe(false);
  });
});
