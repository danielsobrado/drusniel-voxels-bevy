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
const DEBUG_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);
const TIME_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_foam_time_freeze.ts", import.meta.url),
  "utf8",
);

describe("water foam distance acceptance wiring", () => {
  it("uses one rapid pose and one camera placement", () => {
    expect(RUNNER_SOURCE.match(/findWaterShotPose\(/g)).toHaveLength(1);
    expect(RUNNER_SOURCE.match(/setCameraPose\(page, rapidPose\)/g)).toHaveLength(1);
    expect(RUNNER_SOURCE).toContain('"rapid-bed-step"');
  });

  it("freezes time before capturing one body/depth mask and three foam distances", () => {
    const freeze = RUNNER_SOURCE.indexOf("setWaterFoamTimeFrozen(page, true)");
    const body = RUNNER_SOURCE.indexOf('setWaterDebugMode(page, "bodyMask")');
    const near = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.nearM)");
    const mid = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.midM)");
    const far = RUNNER_SOURCE.indexOf("setWaterFoamDistanceOverride(page, distances.farM)");

    expect(freeze).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(freeze);
    expect(near).toBeGreaterThan(body);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
    expect(RUNNER_SOURCE.match(/deriveWaterPixelMask\(/g)).toHaveLength(1);
  });

  it("resets both controls in a finally block", () => {
    expect(RUNNER_SOURCE).toContain("finally {");
    expect(RUNNER_SOURCE).toContain("resetWaterFoamDistanceControls(page)");
    expect(CONTROLS_SOURCE).toContain("distance = await setWaterFoamDistanceOverride(page, null)");
    expect(CONTROLS_SOURCE).toContain("time = await setWaterFoamTimeFrozen(page, false)");
  });

  it("keeps camera and atlas updates live while freezing only clipmap delta", () => {
    expect(TIME_SOURCE).toContain("originalUpdate(frozen ? 0 : deltaSeconds, cameraPosition)");
    expect(TIME_SOURCE).toContain("new WeakMap<WaterClipmap");
    expect(TIME_SOURCE).not.toContain("levels");
    expect(TIME_SOURCE).not.toContain("materialHandle");
  });

  it("exposes controls only through the existing water debug API", () => {
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceOverrideM");
    expect(DEBUG_SOURCE).toContain("setWaterFoamTimeFrozen");
    expect(DEBUG_SOURCE).toContain("setWaterFoamDistanceDebugOverrideM(null)");
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamDistance');
    expect(DEBUG_SOURCE).not.toContain('searchParams.get("foamTime');
  });

  it("gates renderer-specific runtime and browser errors", () => {
    expect(RUNNER_SOURCE).toContain('renderer === "webgl"');
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamWebGlRuntimeContract");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamRuntimeContract");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamBrowserErrorGate");
    expect(RUNNER_SOURCE).toContain("assertRendererBackend(renderer, info.rendererBackend)");
  });
});
