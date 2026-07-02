import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  MaterialChurnDiagnostics,
  applyMaterialIfChanged,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../material_churn_diagnostics.js";

describe("MaterialChurnDiagnostics", () => {
  it("tracks new material once", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    diagnostics.trackNewMaterial(material, "test");
    diagnostics.trackNewMaterial(material, "test");

    expect(diagnostics.frameStats().newMaterials).toBe(1);
    expect(diagnostics.totals().newMaterials).toBe(1);
  });

  it("material assignment is idempotent", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const first = new THREE.MeshBasicMaterial();
    const second = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), first);

    diagnostics.beginFrame(1);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, first, "same")).toBe(false);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, second, "swap")).toBe(true);
    expect(applyMaterialIfChanged(diagnostics, "node-a", mesh, second, "same")).toBe(false);

    expect(diagnostics.frameStats().materialReplacements).toBe(1);
  });

  it("pipeline-sensitive mutation is idempotent", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", false, "same")).toBe(false);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", true, "change")).toBe(true);
    expect(setPipelineSensitiveMaterialProperty(diagnostics, material, "wireframe", true, "same")).toBe(false);

    expect(diagnostics.frameStats().pipelineSensitiveChanges).toBe(1);
    expect(diagnostics.frameStats().suspectedPipelineKeyChanges).toBe(1);
  });

  it("needsUpdate increments suspected churn", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    setMaterialNeedsUpdate(diagnostics, material, "test");

    expect(diagnostics.frameStats().materialNeedsUpdate).toBe(1);
    expect(diagnostics.frameStats().suspectedPipelineKeyChanges).toBe(1);
  });

  it("renderer info missing is safe", () => {
    const diagnostics = new MaterialChurnDiagnostics();

    diagnostics.beginFrame(1);
    expect(() => diagnostics.sampleRendererInfo({})).not.toThrow();
    expect(diagnostics.frameStats().rendererProgramCount).toBeNull();
  });

  it("frame reset preserves totals", () => {
    const diagnostics = new MaterialChurnDiagnostics();
    const material = new THREE.MeshBasicMaterial();

    diagnostics.beginFrame(1);
    diagnostics.trackNewMaterial(material, "test");
    diagnostics.beginFrame(2);

    expect(diagnostics.frameStats().newMaterials).toBe(0);
    expect(diagnostics.totals().newMaterials).toBe(1);
  });
});
