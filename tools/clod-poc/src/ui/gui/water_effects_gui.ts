import type GUI from "lil-gui";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";
import { replaceWaterEffectUrl, type WaterEffectKey, type WaterEffectsState } from "../../water/index.js";

const WATER_EFFECT_CONTROLS: readonly { key: WaterEffectKey; label: string }[] = [
  { key: "glacialMurkiness", label: "glacial murkiness" },
  { key: "rockFlour", label: "rock flour" },
  { key: "reflectionTiers", label: "reflection tiers" },
];

export interface WaterEffectsGuiDeps {
  waterController: Pick<WaterController, "getEffectsState" | "setEffectEnabled">;
  onVisualChanged: () => void;
}

export function addWaterEffectsGui(gui: GUI, deps: WaterEffectsGuiDeps): void {
  const state: WaterEffectsState = { ...deps.waterController.getEffectsState() };
  const folder = gui.addFolder("water / glacial effects");
  for (const control of WATER_EFFECT_CONTROLS) {
    folder.add(state, control.key).name(control.label).onChange((enabled: boolean) => {
      deps.waterController.setEffectEnabled(control.key, enabled);
      replaceWaterEffectUrl(control.key, enabled);
      deps.onVisualChanged();
    });
  }
}
