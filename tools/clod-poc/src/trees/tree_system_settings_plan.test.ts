import { describe, expect, it } from "vitest";
import { cloneTreeSettings, treeGeometryKey } from "./index.js";
import { planTreeSystemSettingsUpdate } from "./tree_system_settings_plan.js";

describe("tree system settings update planner", () => {
  it("detects no-op updates", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, {}, key);

    expect(plan).toEqual({
      nextGeometryKey: key,
      needsGeometry: false,
      needsPatchRefresh: false,
      clearGpuRing: false,
      nextGpuStatus: null,
    });
  });

  it("refreshes patches for non-geometry patch-affecting fields", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, { distanceM: settings.distanceM + 10 }, key);

    expect(plan.nextGeometryKey).toBe(key);
    expect(plan.needsGeometry).toBe(false);
    expect(plan.needsPatchRefresh).toBe(true);
  });

  it("refreshes CPU patches and GPU scatter for ecology changes", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, {
      ecology: {
        ...settings.ecology,
        density: {
          ...settings.ecology.density,
          baseDensity: settings.ecology.density.baseDensity * 0.5,
        },
      },
    }, key);

    expect(plan.nextGeometryKey).toBe(key);
    expect(plan.needsGeometry).toBe(false);
    expect(plan.needsPatchRefresh).toBe(true);
    expect(plan.clearGpuRing).toBe(true);
  });

  it("refreshes scatter and GPU materials for non-geometry species changes", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const nextSpecies = {
      ...settings.species,
      oak: {
        ...settings.species.oak,
        weight: settings.species.oak.weight + 0.25,
      },
    };
    const plan = planTreeSystemSettingsUpdate(settings, { species: nextSpecies }, key);

    expect(plan.nextGeometryKey).toBe(key);
    expect(plan.needsGeometry).toBe(false);
    expect(plan.needsPatchRefresh).toBe(true);
    expect(plan.clearGpuRing).toBe(true);
  });

  it("detects geometry rebuilds and retires GPU draw resources", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const nextSpecies = {
      ...settings.species,
      oak: {
        ...settings.species.oak,
        trunkRadiusM: settings.species.oak.trunkRadiusM + 0.1,
      },
    };
    const plan = planTreeSystemSettingsUpdate(settings, { species: nextSpecies }, key);

    expect(plan.nextGeometryKey).not.toBe(key);
    expect(plan.needsGeometry).toBe(true);
    expect(plan.needsPatchRefresh).toBe(true);
    expect(plan.clearGpuRing).toBe(true);
  });

  it("rebuilds GPU material handles for wind and impostor changes", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const windPlan = planTreeSystemSettingsUpdate(settings, {
      wind: { ...settings.wind, strength: settings.wind.strength + 0.1 },
    }, key);
    const impostorPlan = planTreeSystemSettingsUpdate(settings, {
      impostors: { ...settings.impostors, alphaTest: settings.impostors.alphaTest + 0.01 },
    }, key);

    expect(windPlan.needsGeometry).toBe(false);
    expect(windPlan.needsPatchRefresh).toBe(false);
    expect(windPlan.clearGpuRing).toBe(true);
    expect(impostorPlan.needsGeometry).toBe(false);
    expect(impostorPlan.needsPatchRefresh).toBe(false);
    expect(impostorPlan.clearGpuRing).toBe(true);
  });

  it("rebuilds the GPU ring when shadow ownership changes", () => {
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "none";
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, {
      lod: { ...settings.lod, shadowsMaxLod: "impostor" },
    }, key);

    expect(plan.needsGeometry).toBe(false);
    expect(plan.needsPatchRefresh).toBe(true);
    expect(plan.clearGpuRing).toBe(true);
  });

  it("does not rebuild the GPU ring when the shadow policy is unchanged", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, {
      lod: { ...settings.lod, shadowsMaxLod: settings.lod.shadowsMaxLod },
    }, key);

    expect(plan.needsPatchRefresh).toBe(true);
    expect(plan.clearGpuRing).toBe(false);
  });

  it("plans GPU ring clear and disabled status", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, { gpu: { ...settings.gpu, enabled: false } }, key);

    expect(plan.clearGpuRing).toBe(true);
    expect(plan.nextGpuStatus).toBe("disabled");
  });

  it("plans GPU ring clear and CPU fallback status", () => {
    const settings = cloneTreeSettings();
    const key = treeGeometryKey(settings);
    const plan = planTreeSystemSettingsUpdate(settings, { gpu: { ...settings.gpu, enabled: true, debugForceCpu: true } }, key);

    expect(plan.clearGpuRing).toBe(true);
    expect(plan.nextGpuStatus).toBe("fallback-cpu");
  });
});
