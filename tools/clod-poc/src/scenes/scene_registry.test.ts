import { describe, expect, it } from "vitest";
import {
  isLongViewScene,
  isRegisteredNaadfScene,
  phase0ConfigKeyForScene,
  sceneOptionsByLabel,
  shadowProxySceneMode,
} from "./scene_registry.js";

describe("scene registry", () => {
  it("maps UI labels to scene ids", () => {
    expect(sceneOptionsByLabel()["long view 4 km"]).toBe("long-view-4km");
    expect(sceneOptionsByLabel()["infinite islands"]).toBe("infinite-islands");
  });

  it("centralizes long-view scene metadata", () => {
    expect(isLongViewScene("infinite-islands")).toBe(true);
    expect(phase0ConfigKeyForScene("infinite-far-shell-mountain-approach")).toBe("infinite_far_shell_mountain_approach");
    expect(phase0ConfigKeyForScene("long-view-shadow-proxy-forest")).toBe("long_view_forest_4km");
  });

  it("centralizes NAADF scene metadata", () => {
    expect(isRegisteredNaadfScene("infinite-naadf-far")).toBe(true);
    expect(phase0ConfigKeyForScene("infinite-naadf-mountains")).toBe("infinite_far_shell_mountain_approach");
  });

  it("centralizes shadow proxy scene metadata", () => {
    expect(shadowProxySceneMode("long-view-shadow-proxy-off")).toBe("off");
    expect(shadowProxySceneMode("long-view-shadow-proxy-debug-visible")).toBe("debug-visible");
    expect(shadowProxySceneMode("long-view-shadow-proxy-low-sun")).toBe("low-sun");
  });
});
