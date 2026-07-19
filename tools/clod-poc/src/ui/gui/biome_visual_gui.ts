import type GUI from "lil-gui";
import type { BiomeVisualState } from "../../environment/biome_visual_state.js";
import {
  clearBiomeVisualStateOverride,
  readActiveBiomeVisualState,
  setBiomeVisualStateOverride,
} from "../../environment/biome_visual_state_runtime.js";
import type { GuiController } from "./gui_controller.js";

interface BiomeVisualGuiModel {
  enabled: boolean;
  seasonT: number;
  green: number;
  autumn: number;
  bloom: number;
  snowlineM: number;
  glacialMurkiness: number;
  morningMist: number;
  pollenAmount: number;
  frostAmount: number;
  wetness: number;
  status: string;
  apply: () => void;
  refresh: () => void;
  reset: () => void;
  exportYaml: () => void;
}

export function createBiomeVisualGui(gui: GUI): void {
  const folder = gui.addFolder("biome look development");
  const initial = readActiveBiomeVisualState();
  const model = createModel(initial);
  const valueControllers: GuiController[] = [];
  let statusController: GuiController;

  const updateDisplays = (): void => {
    for (const controller of valueControllers) controller.updateDisplay();
    statusController.updateDisplay();
  };

  const apply = (): void => {
    setBiomeVisualStateOverride({
      enabled: model.enabled,
      seasonT: model.seasonT,
      green: model.green,
      autumn: model.autumn,
      bloom: model.bloom,
      snowlineM: model.snowlineM,
      glacialMurkiness: model.glacialMurkiness,
      morningMist: model.morningMist,
      pollenAmount: model.pollenAmount,
      frostAmount: model.frostAmount,
      wetness: model.wetness,
    });
    model.status = "live override";
    statusController.updateDisplay();
  };

  const refresh = (): void => {
    syncModel(model, readActiveBiomeVisualState());
    model.status = "refreshed";
    updateDisplays();
  };

  const reset = (): void => {
    clearBiomeVisualStateOverride();
    syncModel(model, readActiveBiomeVisualState());
    model.status = "runtime values";
    updateDisplays();
  };

  const exportYaml = async (): Promise<void> => {
    const text = serializeBiomeVisualLookYaml(model);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        model.status = "YAML copied";
      } else {
        console.info("[biome-look-development]\n" + text);
        model.status = "YAML logged";
      }
    } catch (error) {
      console.error("[biome-look-development] export failed", error);
      model.status = "export failed";
    }
    statusController.updateDisplay();
  };

  model.apply = apply;
  model.refresh = refresh;
  model.reset = reset;
  model.exportYaml = () => { void exportYaml(); };

  valueControllers.push(folder.add(model, "enabled").name("enabled").onChange(apply));
  valueControllers.push(folder.add(model, "seasonT", 0, 1, 0.001).name("season marker").onChange(apply));
  valueControllers.push(folder.add(model, "green", 0, 1, 0.01).name("green").onChange(apply));
  valueControllers.push(folder.add(model, "autumn", 0, 1, 0.01).name("autumn").onChange(apply));
  valueControllers.push(folder.add(model, "bloom", 0, 1, 0.01).name("flower bloom").onChange(apply));
  valueControllers.push(folder.add(model, "snowlineM", 0, 10_000, 10).name("snowline m").onChange(apply));
  valueControllers.push(folder.add(model, "glacialMurkiness", 0, 1, 0.01).name("glacial murkiness").onChange(apply));
  valueControllers.push(folder.add(model, "morningMist", 0, 1, 0.01).name("morning mist").onChange(apply));
  valueControllers.push(folder.add(model, "pollenAmount", 0, 1, 0.01).name("pollen").onChange(apply));
  valueControllers.push(folder.add(model, "frostAmount", 0, 1, 0.01).name("frost strength").onChange(apply));
  valueControllers.push(folder.add(model, "wetness", 0, 1, 0.01).name("dew / wetness").onChange(apply));
  folder.add(model, "apply").name("apply values");
  folder.add(model, "refresh").name("refresh resolved");
  folder.add(model, "reset").name("reset override");
  folder.add(model, "exportYaml").name("copy YAML");
  statusController = folder.add(model, "status").name("status").disable();
  folder.close();
}

export function serializeBiomeVisualLookYaml(
  state: Pick<BiomeVisualState,
    | "enabled"
    | "seasonT"
    | "green"
    | "autumn"
    | "bloom"
    | "snowlineM"
    | "glacialMurkiness"
    | "morningMist"
    | "pollenAmount"
    | "frostAmount"
    | "wetness"
  >,
): string {
  return [
    "biome_visual_override:",
    `  enabled: ${state.enabled}`,
    `  season_t: ${format(state.seasonT)}`,
    `  green: ${format(state.green)}`,
    `  autumn: ${format(state.autumn)}`,
    `  bloom: ${format(state.bloom)}`,
    `  snowline_m: ${format(state.snowlineM)}`,
    `  glacial_murkiness: ${format(state.glacialMurkiness)}`,
    `  morning_mist: ${format(state.morningMist)}`,
    `  pollen_amount: ${format(state.pollenAmount)}`,
    `  frost_amount: ${format(state.frostAmount)}`,
    `  wetness: ${format(state.wetness)}`,
    "",
  ].join("\n");
}

function createModel(state: BiomeVisualState | null): BiomeVisualGuiModel {
  const fallback: BiomeVisualState = {
    enabled: false,
    seasonT: 0,
    green: 1,
    autumn: 0,
    bloom: 1,
    snowlineM: 1_000_000,
    glacialMurkiness: 0,
    morningMist: 0,
    pollenAmount: 0,
    frostAmount: 0,
    wetness: 0,
  };
  const source = state ?? fallback;
  return {
    ...source,
    status: state ? "runtime values" : "no active state",
    apply: () => undefined,
    refresh: () => undefined,
    reset: () => undefined,
    exportYaml: () => undefined,
  };
}

function syncModel(model: BiomeVisualGuiModel, state: BiomeVisualState | null): void {
  if (!state) return;
  model.enabled = state.enabled;
  model.seasonT = state.seasonT;
  model.green = state.green;
  model.autumn = state.autumn;
  model.bloom = state.bloom;
  model.snowlineM = state.snowlineM;
  model.glacialMurkiness = state.glacialMurkiness;
  model.morningMist = state.morningMist;
  model.pollenAmount = state.pollenAmount;
  model.frostAmount = state.frostAmount;
  model.wetness = state.wetness;
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(4)).toString();
}
