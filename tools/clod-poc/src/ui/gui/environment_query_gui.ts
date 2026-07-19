import type GUI from "lil-gui";
import {
  formatEnvironmentQueryMeta,
  formatEnvironmentQueryProbeValues,
  sampleEnvironmentQueryProbe,
} from "../../environment_query/probe.js";
import { readActiveEnvironmentQuery } from "../../environment_query/runtime.js";
import type { EnvironmentQuery } from "../../environment_query/types.js";
import type { GuiController } from "./gui_controller.js";

export interface EnvironmentQueryGuiDeps {
  readonly getCameraPosition: () => { x: number; z: number };
  readonly getQuery?: () => EnvironmentQuery | null;
}

interface EnvironmentQueryGuiModel {
  x: number;
  z: number;
  hintM: number;
  status: string;
  surface: string;
  normal: string;
  material: string;
  water: string;
  river: string;
  visibility: string;
  values: string;
  probeCoordinates: () => void;
  probeCamera: () => void;
}

export function createEnvironmentQueryGui(gui: GUI, deps: EnvironmentQueryGuiDeps): void {
  const folder = gui.addFolder("environment query probe");
  const getQuery = deps.getQuery ?? readActiveEnvironmentQuery;
  const model: EnvironmentQueryGuiModel = {
    x: 0,
    z: 0,
    hintM: 16,
    status: "not sampled",
    surface: "not sampled",
    normal: "not sampled",
    material: "not sampled",
    water: "not sampled",
    river: "not sampled",
    visibility: "not sampled",
    values: "not sampled",
    probeCoordinates: () => undefined,
    probeCamera: () => undefined,
  };
  const readouts: GuiController[] = [];

  const refresh = (): void => {
    for (const controller of readouts) controller.updateDisplay();
  };
  const probe = (): void => {
    const query = getQuery();
    if (!query) {
      model.status = "no active query";
      refresh();
      return;
    }
    const sample = sampleEnvironmentQueryProbe(query, model.x, model.z, model.hintM);
    model.hintM = sample.hintM;
    model.status = "sampled";
    model.surface = formatEnvironmentQueryMeta(sample.surface.meta);
    model.normal = formatEnvironmentQueryMeta(sample.normal.meta);
    model.material = formatEnvironmentQueryMeta(sample.material.meta);
    model.water = formatEnvironmentQueryMeta(sample.water.meta);
    model.river = formatEnvironmentQueryMeta(sample.river.meta);
    model.visibility = formatEnvironmentQueryMeta(sample.visibility.meta);
    model.values = formatEnvironmentQueryProbeValues(sample);
    hintController.updateDisplay();
    refresh();
  };

  model.probeCoordinates = probe;
  model.probeCamera = () => {
    const camera = deps.getCameraPosition();
    model.x = finiteOr(camera.x, 0);
    model.z = finiteOr(camera.z, 0);
    xController.updateDisplay();
    zController.updateDisplay();
    probe();
  };

  const xController = folder.add(model, "x", -1_000_000, 1_000_000, 1).name("world x");
  const zController = folder.add(model, "z", -1_000_000, 1_000_000, 1).name("world z");
  const hintController = folder.add(model, "hintM", 0.01, 65_536, 0.01).name("sample hint m");
  folder.add(model, "probeCoordinates").name("probe coordinates");
  folder.add(model, "probeCamera").name("probe camera");
  readouts.push(folder.add(model, "status").name("status").disable());
  readouts.push(folder.add(model, "surface").name("surface owner").disable());
  readouts.push(folder.add(model, "normal").name("normal owner").disable());
  readouts.push(folder.add(model, "material").name("material owner").disable());
  readouts.push(folder.add(model, "water").name("water owner").disable());
  readouts.push(folder.add(model, "river").name("river owner").disable());
  readouts.push(folder.add(model, "visibility").name("visibility owner").disable());
  readouts.push(folder.add(model, "values").name("sample values").disable());
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
