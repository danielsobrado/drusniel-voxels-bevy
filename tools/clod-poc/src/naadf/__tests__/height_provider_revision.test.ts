import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { initNaadfIntegration, type NaadfIntegration } from "../integration.js";
import { clearSaveInvalidationTargets } from "../../save/save_far_summary_bridge.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

afterEach(() => {
  clearSaveInvalidationTargets();
});

function makeTestYaml(): string {
  return naadfYaml
    .replace("radius_chunks_xz: 32", "radius_chunks_xz: 2")
    .replace(/^(\s*far_clipmap:\s*\n\s*)enabled: true/m, "$1enabled: false");
}

function initActiveIntegration(): NaadfIntegration {
  const integration = initNaadfIntegration({
    yamlText: makeTestYaml(),
    sceneName: null,
    forceEnable: true,
  });
  if (!integration) throw new Error("expected NAADF integration to initialize");
  return integration;
}

describe("NAADF height provider revision", () => {
  it("stays stable across frames without new streaming work", () => {
    const integration = initActiveIntegration();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 100, 0);

    for (let i = 0; i < 200; i++) integration.update(i, 0.016, camera);

    const revisionBefore = integration.getHeightProvider().revision?.() ?? 0;
    const frameBefore = integration.state.frame;
    expect(frameBefore).toBeGreaterThan(0);

    for (let i = 200; i < 220; i++) integration.update(i, 0.016, camera);

    expect(integration.state.frame).toBeGreaterThan(frameBefore);
    expect(integration.getHeightProvider().revision?.() ?? 0).toBe(revisionBefore);

    integration.dispose();
  });
});
