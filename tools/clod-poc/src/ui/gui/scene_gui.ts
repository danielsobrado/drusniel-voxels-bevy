import type GUI from "lil-gui";
import { sceneFromSearchParams, sceneOptionsByLabel } from "../../scenes/scene_registry.js";

function currentScene(): string {
  return sceneFromSearchParams(new URLSearchParams(location.search)) ?? "";
}

function applyScene(value: string): void {
  const next = new URLSearchParams(location.search);
  if (value) next.set("scene", value);
  else next.delete("scene");
  const query = next.toString();
  location.assign(`${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
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
