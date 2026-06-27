import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getNaadfIntegrationFromWindow, setNaadfIntegration } from "../canopyBridge.js";
import type { NaadfIntegration } from "../integration.js";

function stubIntegration(): NaadfIntegration {
  return {
    config: {} as NaadfIntegration["config"],
    state: {} as NaadfIntegration["state"],
    metrics: {} as NaadfIntegration["metrics"],
    debugOverlay: null,
    update: () => {},
    getHeightProvider: () => ({
      sampleHeight: () => 0,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
      sampleMaterial: () => 0,
    }),
    getCanopySampler: () => ({ sampleCanopyCoverage: () => 0 }),
    queryHeight: () => ({
      height: 0,
      material: 0,
      canopyCoverage: 0,
      waterCoverage: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      unknown: false,
      source: "macro",
      nearTableHit: false,
      hashFallbackHit: false,
      farClipmapHit: false,
      missingSample: false,
    }),
    traceSun: () => ({
      visible: true,
      unknown: false,
      blocked: false,
      steps: 0,
      aadfSkips: 0,
      nearTableHits: 0,
      hashFallbackHits: 0,
      farClipmapHits: 0,
      missingSamples: 0,
    }),
    getFarSummaryGpuAtlasView: () => undefined,
    getMetricsSnapshot: () => ({} as ReturnType<NaadfIntegration["getMetricsSnapshot"]>),
    getAcceptanceStatus: () => ({ checks: [], passed: true }),
    dispose: () => {},
  };
}

describe("naadf integration registry", () => {
  it("clears active integration and window global when set to undefined", () => {
    const integration = stubIntegration();
    setNaadfIntegration(integration);
    expect(getNaadfIntegrationFromWindow()).toBe(integration);

    setNaadfIntegration(undefined);
    expect(getNaadfIntegrationFromWindow()).toBeUndefined();
    if (typeof window !== "undefined") {
      expect((window as { __drusnielNaadf?: unknown }).__drusnielNaadf).toBeUndefined();
    }
  });
});
