import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIAL_CHURN_CONFIG,
  MaterialChurnDiagnostics,
  applyMaterialIfChanged,
  materialChurnConfigForQuery,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../material_churn_diagnostics.js";

function enabledDiagnostics(): MaterialChurnDiagnostics {
  return new MaterialChurnDiagnostics({
    enabled: true,
    collectMaterialVersions: true,
    collectRendererPrograms: true,
  });
}

describe("MaterialChurnDiagnostics", () => {
  it("is disabled by default", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    diagnostics.trackNewMaterial(material, "test");

    expect(diagnostics.frameStats().enabled).toBe(false);
    expect(diagnostics.frameStats().newMaterials).toBe(0);
    expect(diagnostics.totals().newMaterials).toBe(0);
  });

  it("tracks new material once when enabled", () => {
    const diagnostics = enabledDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    diagnostics.trackNewMaterial(material, "test");
    diagnostics.trackNewMaterial(material, "test");

    expect(diagnostics.frameStats().newMaterials).toBe(1);
    expect(diagnostics.totals().newMaterials).toBe(1);
  });

  it("material assignment is idempotent when enabled", () => {
    const diagnostics = enabledDiagnostics();
    const first = new THREE.MeshBasicMaterial();
    const second = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), first);

    diagnostics.beginFrame(1);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, first, "same")).toBe(false);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, second, "swap")).toBe(true);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, second, "same")).toBe(false);

    expect(diagnostics.frameStats().materialReplacements).toBe(1);
  });

  it("pipeline-sensitive mutation is idempotent when enabled", () => {
    const diagnostics = enabledDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", false, "same")).toBe(false);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", true, "change")).toBe(true);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", true, "same")).toBe(false);

    expect(diagnostics.frameStats().pipelineSensitiveChanges).toBe(1);
    expect(diagnostics.frameStats().suspectedPipelineKeyChanges).toBe(1);
  });

  it("needsUpdate increments suspected churn when enabled", () => {
    const diagnostics = enabledDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    setMaterialNeedsUpdate(diagnostics, material, "test");

    expect(diagnostics.frameStats().materialNeedsUpdate).toBe(1);
    expect(diagnostics.frameStats().suspectedPipelineKeyChanges).toBe(1);
  });

  it("renderer info missing is safe", () => {
    const diagnostics = enabledDiagnostics();

    diagnostics.beginFrame(1);
    expect(() => diagnostics.sampleRendererInfo({})).not.toThrow();
    expect(diagnostics.frameStats().rendererProgramCount).toBeNull();
  });

  it("frame reset preserves totals when enabled", () => {
    const diagnostics = enabledDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    diagnostics.trackNewMaterial(material, "test");
    diagnostics.beginFrame(2);

    expect(diagnostics.frameStats().newMaterials).toBe(0);
    expect(diagnostics.totals().newMaterials).toBe(1);
  });

  it("enables diagnostics from profile query", () => {
    const config = materialChurnConfigForQuery(
      DEFAULT_MATERIAL_CHURN_CONFIG,
      new URLSearchParams("profile=1"),
    );

    expect(config.enabled).toBe(true);
    expect(config.collectMaterialVersions).toBe(true);
    expect(config.collectRendererPrograms).toBe(true);
  });

  it("allows explicit material churn query override", () => {
    const config = materialChurnConfigForQuery(
      { ...DEFAULT_MATERIAL_CHURN_CONFIG, enabled: true, collectMaterialVersions: true, collectRendererPrograms: true },
      new URLSearchParams("materialChurn=0"),
    );

    expect(config.enabled).toBe(false);
    expect(config.collectMaterialVersions).toBe(false);
    expect(config.collectRendererPrograms).toBe(false);
  });
});
