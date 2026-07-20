import type GUI from "lil-gui";
import {
  oceanRimEnabled,
  setOceanRimQuery,
} from "../../app/ocean_rim_query.js";
import { sceneFromSearchParams, sceneOptionsByLabel } from "../../scenes/scene_registry.js";

function currentParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function currentScene(): string {
  return sceneFromSearchParams(currentParams()) ?? "";
}

function navigate(params: URLSearchParams): void {
  const query = params.toString();
  location.assign(`${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function applyScene(value: string): void {
  const next = currentParams();
  if (value) next.set("scene", value);
  else next.delete("scene");
  navigate(next);
}

function applyOceanRim(enabled: boolean): void {
  navigate(setOceanRimQuery(currentParams(), enabled));
}

export function createSceneGui(gui: GUI): void {
  const folder = gui.addFolder("scene");
  const state = {
    scene: currentScene(),
    oceanRim: oceanRimEnabled(currentParams()),
  };
  folder
    .add(state, "scene", sceneOptionsByLabel())
    .name("scene (reloads)")
    .onChange((value: string) => {
      if (value === currentScene()) return;
      applyScene(value);
    });
  folder
    .add(state, "oceanRim")
    .name("ocean rim (reloads)")
    .onChange((enabled: boolean) => {
      if (enabled === oceanRimEnabled(currentParams())) return;
      applyOceanRim(enabled);
    });
}
