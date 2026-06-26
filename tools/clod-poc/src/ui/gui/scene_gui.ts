import type GUI from "lil-gui";
import { NAADF_SCENES } from "../../naadf/integration.js";
import { RIVER_PARITY_TEST_SCENE } from "../../water/riverParityScene.js";

interface SceneOption {
  label: string;
  value: string;
}

const SCENE_OPTIONS: readonly SceneOption[] = [
  { label: "default", value: "" },
  { label: "grass perf", value: "grass-perf" },
  { label: "trees perf", value: "trees-perf" },
  { label: "forest floor", value: "forest-floor" },
  { label: "border ocean", value: "border-ocean" },
  { label: "river parity test", value: RIVER_PARITY_TEST_SCENE },
  { label: "long view 4 km", value: "long-view-4km" },
  { label: "long view forest 4 km", value: "long-view-forest-4km" },
  { label: "long view edit stress", value: "long-view-edit-stress" },
  { label: "long view 8 km", value: "long-view-8km" },
  { label: "long view 16 km", value: "long-view-16km" },
  { label: "stream straight", value: "infinite-stream-straight" },
  { label: "stream fast turn", value: "infinite-stream-fast-turn" },
  { label: "stream far summary", value: "infinite-stream-far-summary" },
  { label: "stream slow builds", value: "infinite-stream-slow-builds" },
  { label: "far shell straight", value: "infinite-far-shell-straight" },
  { label: "far shell fast turn", value: "infinite-far-shell-fast-turn" },
  { label: "far shell mountain approach", value: "infinite-far-shell-mountain-approach" },
  { label: "shadow proxy basic", value: "long-view-shadow-proxy-basic" },
  { label: "shadow proxy off", value: "long-view-shadow-proxy-off" },
  { label: "shadow proxy debug visible", value: "long-view-shadow-proxy-debug-visible" },
  { label: "shadow proxy forest", value: "long-view-shadow-proxy-forest" },
  { label: "shadow proxy low sun", value: "long-view-shadow-proxy-low-sun" },
  ...Array.from(NAADF_SCENES).map((scene) => ({
    label: scene.replaceAll("-", " "),
    value: scene,
  })),
];

function currentScene(): string {
  return new URLSearchParams(location.search).get("scene") ?? "";
}

function sceneOptionsByLabel(): Record<string, string> {
  return Object.fromEntries(SCENE_OPTIONS.map((scene) => [scene.label, scene.value]));
}

function applyScene(value: string): void {
  const next = new URLSearchParams(location.search);
  if (value) next.set("scene", value);
  else next.delete("scene");
  location.search = `?${next.toString()}`;
}

export function createSceneGui(gui: GUI): void {
  const folder = gui.addFolder("scene");
  const state = { scene: currentScene() };
  folder
    .add(state, "scene", sceneOptionsByLabel())
    .name("scene (reloads)")
    .onChange((value: string) => {
      if (value === currentScene()) return;
      applyScene(value);
    });
}
