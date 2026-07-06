import { afterEach, describe, expect, it } from "vitest";
import { initNaadfIntegration, type NaadfIntegration } from "../integration.js";
import { clearSaveInvalidationTargets, markSaveInvalidationBounds } from "../../save/save_far_summary_bridge.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

const DIRTY_BOUNDS = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };

afterEach(() => {
  clearSaveInvalidationTargets();
});

describe("NAADF integration lifecycle", () => {
  it("unregisters the previous save invalidation target when reinitialized", () => {
    const first = initActiveIntegration();
    expect(first.metrics.invalidationBoundsCount).toBe(0);

    const second = initActiveIntegration();
    markSaveInvalidationBounds(DIRTY_BOUNDS);

    expect(first.metrics.invalidationBoundsCount).toBe(0);
    expect(second.metrics.invalidationBoundsCount).toBe(1);
    second.dispose();
  });

  it("unregisters the active save invalidation target when integration is disabled", () => {
    const active = initActiveIntegration();
    expect(active.metrics.invalidationBoundsCount).toBe(0);

    const disabled = initNaadfIntegration({
      yamlText: naadfYaml,
      sceneName: null,
      forceEnable: false,
    });
    markSaveInvalidationBounds(DIRTY_BOUNDS);

    expect(disabled).toBeNull();
    expect(active.metrics.invalidationBoundsCount).toBe(0);
  });
});

function initActiveIntegration(): NaadfIntegration {
  const integration = initNaadfIntegration({
    yamlText: naadfYaml,
    sceneName: null,
    forceEnable: true,
  });
  if (!integration) throw new Error("expected NAADF integration to initialize");
  return integration;
}
