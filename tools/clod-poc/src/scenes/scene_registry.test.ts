import { describe, expect, it } from "vitest";
import {
  earlySceneRoute,
  isLongViewScene,
  isRegisteredNaadfScene,
  phase0ConfigKeyForScene,
  sceneFromSearchParams,
  sceneOptionsByLabel,
  shadowProxySceneMode,
} from "./scene_registry.js";

describe("scene registry", () => {
  it("maps UI labels to scene ids", () => {
    expect(sceneOptionsByLabel()["long view 4 km"]).toBe("long-view-4km");
    expect(sceneOptionsByLabel()["infinite islands"]).toBe("infinite-islands");
    expect(sceneOptionsByLabel()["RPG village"]).toBe("rpg-village");
    expect(sceneOptionsByLabel()["RPG player base"]).toBe("rpg-player-base");
  });

  it("keeps early-only routes out of the GUI selector", () => {
    expect(earlySceneRoute("sanity")).toBe("sanity");
    expect(sceneOptionsByLabel().sanity).toBeUndefined();
  });

  it("centralizes long-view scene metadata", () => {
    expect(isLongViewScene("infinite-islands")).toBe(true);
    expect(phase0ConfigKeyForScene("infinite-far-shell-mountain-approach")).toBe("infinite_far_shell_mountain_approach");
    expect(phase0ConfigKeyForScene("long-view-shadow-proxy-forest")).toBe("long_view_forest_4km");
    expect(phase0ConfigKeyForScene("rpg-village")).toBe("rpg_village");
    expect(phase0ConfigKeyForScene("rpg-player-base")).toBe("rpg_player_base");
  });

  it("preserves RPG identity after the runtime scene is canonicalized to continent", () => {
    const params = new URLSearchParams({ scene: "continent", rpgDensityScene: "rpg-village" });
    expect(sceneFromSearchParams(params)).toBe("rpg-village");
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
