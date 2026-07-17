import { describe, expect, it } from "vitest";
import { compactStageList, postFxCaseDiagnostics } from "./postfx_case_diagnostics.js";

describe("postfx case diagnostics", () => {
  it("describes the configured default post stack", () => {
    const diagnostics = postFxCaseDiagnostics({});
    expect(diagnostics.postEnabled).toBe(true);
    expect(diagnostics.stages.aerial).toBe(true);
    expect(diagnostics.stages.autoExposure).toBe(true);
    expect(diagnostics.stages.bloom).toBe(true);
    expect(diagnostics.stages.contact).toBe(true);
    expect(diagnostics.stages.froxels).toBe(true);
    expect(diagnostics.stages.godrays).toBe(true);
    expect(diagnostics.stages.taa).toBe(false);
    expect(diagnostics.stages.gtao).toBe(false);
    expect(diagnostics.stages.bounce).toBe(false);
    expect(diagnostics.stages.clouds).toBe(false);
  });

  it("marks post disabled when fx is off", () => {
    const diagnostics = postFxCaseDiagnostics({ fx: "0", contact: "1", gtao: "1", bounce: "1", froxels: "1" });
    expect(diagnostics.postEnabled).toBe(false);
    expect(compactStageList(diagnostics)).toBe("off");
    expect(Object.values(diagnostics.stages).every((enabled) => !enabled)).toBe(true);
  });

  it("applies postmin and keeps only color script", () => {
    const diagnostics = postFxCaseDiagnostics({ postmin: "1", contact: "1", gtao: "1", bounce: "1", froxels: "1" });
    expect(diagnostics.postMin).toBe(true);
    expect(diagnostics.stages.colorScript).toBe(true);
    expect(diagnostics.stages.bloom).toBe(false);
    expect(diagnostics.stages.taa).toBe(false);
    expect(diagnostics.stages.contact).toBe(false);
    expect(diagnostics.stages.froxels).toBe(false);
    expect(diagnostics.stages.gtao).toBe(false);
    expect(diagnostics.stages.bounce).toBe(false);
    expect(diagnostics.stages.godrays).toBe(false);
  });

  it("applies settings query flags before ablation", () => {
    const diagnostics = postFxCaseDiagnostics({
      clouds: "1",
      taa: "1",
      contact: "0",
      gtao: "1",
      ablate: "ao,taa",
    });
    expect(diagnostics.stages.clouds).toBe(true);
    expect(diagnostics.stages.contact).toBe(false);
    expect(diagnostics.stages.gtao).toBe(false);
    expect(diagnostics.stages.taa).toBe(false);
  });

  it("prints a compact active stage list", () => {
    const diagnostics = postFxCaseDiagnostics({ ablate: "bloom,taa" });
    expect(compactStageList(diagnostics)).toBe("aerial+autoExposure+colorScript+contact+froxels+godrays");
  });

  it("tracks the god-rays stage from ?godrays mode values and flags", () => {
    expect(postFxCaseDiagnostics({}).stages.godrays).toBe(true);
    expect(postFxCaseDiagnostics({ godrays: "cheap" }).stages.godrays).toBe(true);
    expect(postFxCaseDiagnostics({ godrays: "off" }).stages.godrays).toBe(false);
    expect(postFxCaseDiagnostics({ godrays: "0" }).stages.godrays).toBe(false);
    expect(postFxCaseDiagnostics({ ablate: "godrays" }).stages.godrays).toBe(false);
  });

  it("mirrors volumetric mode forcing the froxel ambience layer", () => {
    expect(postFxCaseDiagnostics({ godrays: "volumetric", froxels: "0" }).stages.froxels).toBe(true);
    expect(postFxCaseDiagnostics({ godrays: "heavy", froxels: "0" }).stages.froxels).toBe(false);
    expect(postFxCaseDiagnostics({ godrays: "volumetric", froxels: "0", ablate: "froxels" }).stages.froxels).toBe(false);
    expect(postFxCaseDiagnostics({ godrays: "volumetric", froxels: "0", ablate: "godrays" }).stages.froxels).toBe(false);
  });
});
