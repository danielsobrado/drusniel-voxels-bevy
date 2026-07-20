import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUNNER_SOURCE = readFileSync(
  new URL("./water-foam-distance-acceptance.ts", import.meta.url),
  "utf8",
);
const CONTROLS_SOURCE = readFileSync(
  new URL("./water-foam-distance-browser-controls.ts", import.meta.url),
  "utf8",
);
const EVIDENCE_SOURCE = readFileSync(
  new URL("./water-foam-distance-evidence.ts", import.meta.url),
  "utf8",
);
const DEBUG_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);
const TIME_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_foam_time_freeze.ts", import.meta.url),
  "utf8",
);
const AUXILIARY_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_foam_auxiliary_visibility.ts", import.meta.url),
  "utf8",
);

describe("water foam distance acceptance wiring", () => {
  it("removes stale report and screenshots before browser startup", () => {
    const clear = RUNNER_SOURCE.indexOf("clearWaterFoamDistanceEvidence(evidence)");
    const harness = RUNNER_SOURCE.indexOf("withWaterHarness(");

    expect(clear).toBeGreaterThan(0);
    expect(harness).toBeGreaterThan(clear);
    expect(EVIDENCE_SOURCE).toContain("rmSync(evidence.reportPath, { force: true })");
    expect(EVIDENCE_SOURCE).toContain("Object.values(evidence.files)");
  });

  it("uses one rapid pose and one camera placement", () => {
    expect(RUNNER_SOURCE.match(/findWaterShotPose\(/g)).toHaveLength(1);
    expect(RUNNER_SOURCE.match(/setCameraPose\(page, rapidPose\)/g)).toHaveLength(1);
    expect(RUNNER_SOURCE).toContain('"rapid-bed-step"');
  });

  it("isolates auxiliary overlays and freezes time before fixed-mask captures", () => {
    const auxiliary = RUNNER_SOURCE.indexOf("setWaterFoamAuxiliaryOverlaysHidden(page, true)");
    const freeze = RUNNER_SOURCE.indexOf("setWaterFoamTimeFrozen(page, true)");
    const body = RUNNER_SOURCE.indexOf('setWaterDebugMode(page, "bodyMask")');
    const near = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.nearM)");
    const mid = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.midM)");
    const far = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.farM)");

    expect(auxiliary).toBeGreaterThan(0);
    expect(freeze).toBeGreaterThan(auxiliary);
    expect(body).toBeGreaterThan(freeze);
    expect(near).toBeGreaterThan(body);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
    expect(RUNNER_SOURCE.match(/deriveWaterPixelMask\(/g)).toHaveLength(1);
  });

  it("always resets controls and preserves capture plus cleanup failures", () => {
    expect(RUNNER_SOURCE).toContain("runWaterFoamDistanceCapture(page");
    expect(CONTROLS_SOURCE).toContain("resetWaterFoamDistanceControls(page)");
    expect(CONTROLS_SOURCE).toContain("distance = await setWaterFoamDistanceOverride(page, null)");
    expect(CONTROLS_SOURCE).toContain("time = await setWaterFoamTimeFrozen(page, false)");
    expect(CONTROLS_SOURCE).toContain(
      "auxiliary = await setWaterFoamAuxiliaryOverlaysHidden(page, false)",
    );
    expect(CONTROLS_SOURCE).toContain("foam distance capture failed:");
    expect(CONTROLS_SOURCE).toContain("cleanup failed:");
  });

  it("keeps camera and atlas updates live while freezing only clipmap delta", () => {
    expect(TIME_SOURCE).toContain("originalUpdate(frozen ? 0 : deltaSeconds, cameraPosition)");
    expect(TIME_SOURCE).toContain("new WeakMap<WaterClipmap");
    expect(TIME_SOURCE).not.toContain("levels");
    expect(TIME_SOURCE).not.toContain("materialHandle");
  });

  it("isolates only the three known auxiliary water overlays", () => {
    expect(AUXILIARY_SOURCE).toContain('"river-bank-residue-overlay"');
    expect(AUXILIARY_SOURCE).toContain('"river-cascade-particles"');
    expect(AUXILIARY_SOURCE).toContain('"river-mist-overlay"');
    expect(AUXILIARY_SOURCE).toContain("object.visible = snapshot.visible");
    expect(AUXILIARY_SOURCE).toContain("new WeakMap<THREE.Scene");
  });

  it("exposes controls only through the existing water debug API", () => {
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceOverrideM");
    expect(DEBUG_SOURCE).toContain("setWaterFoamTimeFrozen");
    expect(DEBUG_SOURCE).toContain("setWaterFoamAuxiliaryOverlaysHidden");
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceDebugOverrideM(null)");
    expect(DEBUG_SOURCE).toContain("auxiliaryVisibility.setHidden(false)");
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamDistance');
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamTime');
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamAuxiliary');
  });

  it("gates renderer-specific runtime and browser errors", () => {
    expect(RUNNER_SOURCE).toContain('renderer === "webgl"');
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamWebGlRuntimeContract");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamRuntimeContract");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamBrowserErrorGate");
    expect(RUNNER_SOURCE).toContain("assertRendererBackend(renderer, info.rendererBackend)");
  });
});
