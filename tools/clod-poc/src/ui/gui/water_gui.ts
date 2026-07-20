import type GUI from "lil-gui";
import {
  addWaterDebugFolder,
  WATER_DEBUG_MODES,
  type WaterDebugState,
  type WaterRiverDebugStats,
} from "../../water/index.js";
import {
  applyWaterReferencePreset,
  WATER_REFERENCE_PRESET_OPTIONS,
  type WaterReferencePreset,
} from "../../water/water_reference_presets.js";
import { WATER_NORMAL_MODEL_OPTIONS } from "../../water/water_normal_models.js";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";
import { addWaterEffectsGui } from "./water_effects_gui.js";

export interface WaterGuiDeps {
  waterController: WaterController;
  waterDebugState: WaterDebugState;
  makeWaterVisual: () => ReturnType<WaterController["makeVisual"]>;
  setWaterEnabled: (enabled: boolean) => void;
  setWaterDebugMode: (mode: keyof typeof WATER_DEBUG_MODES) => void;
  setWaterClipmapTint: (enabled: boolean) => void;
  setWaterWireframe: (enabled: boolean) => void;
  setWaterDepthWrite: (on: boolean) => void;
}

type WaterVisual = ReturnType<WaterController["makeVisual"]>;
type WaterDebugModeKey = keyof typeof WATER_DEBUG_MODES;

type RiverStatsController = WaterController & {
  getRiverStats?: () => WaterRiverDebugStats;
};

interface ColorBinding {
  value: string;
}

function emptyRiverStats(): WaterRiverDebugStats {
  return {
    source: "unknown",
    hydrologyEnabled: false,
    riverCells: 0,
    lakeCells: 0,
    wetCells: 0,
    maxFlowSpeed: 0,
    fallbackRivers: false,
    fallbackMainRiver: false,
    fallbackTributaries: false,
    widenRadius: 0,
    carveDepthM: 0,
    visibleDepthM: 0,
    flowSpeedMultiplier: 1,
    fakeRiverCount: 0,
  };
}

function riverStats(controller: WaterController): WaterRiverDebugStats {
  const withStats = controller as RiverStatsController;
  return typeof withStats.getRiverStats === "function" ? withStats.getRiverStats() : emptyRiverStats();
}

function toHexColor(rgb: [number, number, number]): string {
  const toHex = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");

  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function fromHexColor(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  if (normalized.length !== 6) return [0, 0, 0];

  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function addColorControl(
  folder: GUI,
  label: string,
  initial: [number, number, number],
  onChange: (next: [number, number, number]) => void,
): void {
  const binding: ColorBinding = { value: toHexColor(initial) };
  folder.addColor(binding, "value").name(label).onChange((value: string) => {
    onChange(fromHexColor(value));
  });
}

function addDeepWaterLookFolder(
  gui: GUI,
  visual: WaterVisual,
  rebuild: () => void,
): void {
  const folder = gui.addFolder("water / deep water look");
  const reference = { preset: "custom" as WaterReferencePreset };
  const referenceController = folder.add(reference, "preset", WATER_REFERENCE_PRESET_OPTIONS)
    .name("reference look")
    .onChange((preset: WaterReferencePreset) => {
      applyWaterReferencePreset(visual, preset);
      rebuild();
      folder.controllersRecursive().forEach((controller) => controller.updateDisplay());
    });
  const rebuildCustom = () => {
    reference.preset = "custom";
    referenceController.updateDisplay();
    rebuild();
  };

  folder.add(visual, "normalModel", WATER_NORMAL_MODEL_OPTIONS)
    .name("normal algorithm")
    .onChange(rebuildCustom);

  addColorControl(folder, "deep color", visual.deepColor, (next) => {
    visual.deepColor = next;
    rebuildCustom();
  });

  addColorControl(folder, "shallow teal", visual.shallowColor, (next) => {
    visual.shallowColor = next;
    rebuildCustom();
  });

  addColorControl(folder, "foam color", visual.foamColor, (next) => {
    visual.foamColor = next;
    rebuildCustom();
  });

  folder.add(visual, "alpha", 0.35, 1.0, 0.01).name("alpha").onChange(rebuildCustom);
  folder.add(visual.color, "depthScale", 0.5, 16.0, 0.1).name("depth scale").onChange(rebuildCustom);
  folder.add(visual.color, "turbidity", 0.0, 0.8, 0.01).name("turbidity").onChange(rebuildCustom);

  folder.add(visual.fresnel, "base", 0.0, 0.35, 0.005).name("fresnel base").onChange(rebuildCustom);
  folder.add(visual.fresnel, "power", 1.0, 9.0, 0.1).name("fresnel power").onChange(rebuildCustom);
  folder.add(visual.fresnel, "normalFlatten", 0.0, 1.0, 0.01).name("normal flatten").onChange(rebuildCustom);

  folder.add(visual, "rippleAmp", 0.0, 3.0, 0.01).name("wave normal amp").onChange(rebuildCustom);
  folder.add(visual, "rippleSpeed", 0.0, 2.0, 0.01).name("wave speed").onChange(rebuildCustom);
  folder.add(visual, "rippleScaleA", 0.02, 0.5, 0.005).name("wave scale A").onChange(rebuildCustom);
  folder.add(visual, "rippleScaleB", 0.02, 0.5, 0.005).name("wave scale B").onChange(rebuildCustom);
  folder.add(visual, "rippleStrengthA", 0.0, 0.8, 0.01).name("normal str A").onChange(rebuildCustom);
  folder.add(visual, "rippleStrengthB", 0.0, 0.8, 0.01).name("normal str B").onChange(rebuildCustom);

  folder.add(visual.glitter, "enabled").name("sun glitter").onChange(rebuildCustom);
  folder.add(visual.glitter, "tightExponent", 16, 512, 1).name("glitter tight exp").onChange(rebuildCustom);
  folder.add(visual.glitter, "tightGain", 0.0, 2.0, 0.01).name("glitter tight gain").onChange(rebuildCustom);
  folder.add(visual.glitter, "broadExponent", 4, 192, 1).name("glitter broad exp").onChange(rebuildCustom);
  folder.add(visual.glitter, "broadGain", 0.0, 1.0, 0.01).name("glitter broad gain").onChange(rebuildCustom);

  folder.add(visual.reflection, "skyFallbackStrength", 0.0, 2.0, 0.01).name("sky reflect").onChange(rebuildCustom);
  folder.add(visual.reflection, "terrainFallbackStrength", 0.0, 1.0, 0.01).name("terrain reflect").onChange(rebuildCustom);

  folder.add(visual.foam, "noiseScale", 0.01, 0.25, 0.005).name("foam noise").onChange(rebuildCustom);
  folder.add(visual.foam, "shoreStrength", 0.0, 2.0, 0.01).name("shore foam").onChange(rebuildCustom);
  folder.add(visual.foam, "riverStrength", 0.0, 2.0, 0.01).name("river foam").onChange(rebuildCustom);
}

function addWaterRefractionFolder(
  gui: GUI,
  visual: WaterVisual,
  rebuild: () => void,
  setDebugMode: (mode: WaterDebugModeKey) => void,
): void {
  const folder = gui.addFolder("water / refraction");
  const actions = {
    showRefraction: () => setDebugMode("refraction"),
    showFinal: () => setDebugMode("final"),
  };

  folder.add(visual.refraction, "enabled").name("enabled").onChange(rebuild);
  folder.add(visual.refraction, "strength", 0.0, 0.16, 0.001).name("strength").onChange(rebuild);
  folder.add(visual.refraction, "depthValidationBias", 0.0, 0.25, 0.005).name("depth bias").onChange(rebuild);
  folder.add(visual.refraction, "maxThickness", 0.25, 32.0, 0.25).name("max thickness").onChange(rebuild);
  folder.add(visual.refraction, "turbidityStrength", 0.0, 0.20, 0.002).name("turbidity").onChange(rebuild);
  folder.add(visual.refraction, "absorptionR", 0.0, 1.0, 0.005).name("absorb R").onChange(rebuild);
  folder.add(visual.refraction, "absorptionG", 0.0, 1.0, 0.005).name("absorb G").onChange(rebuild);
  folder.add(visual.refraction, "absorptionB", 0.0, 1.0, 0.005).name("absorb B").onChange(rebuild);
  folder.add(actions, "showRefraction").name("debug refraction");
  folder.add(actions, "showFinal").name("debug final");
}

function syncWaterEffectVisual(target: WaterVisual, next: WaterVisual): void {
  target.bodies = next.bodies;
  target.glacialMurkiness = next.glacialMurkiness;
  target.rockFlour = next.rockFlour;
  target.reflection.clipmapTiers = next.reflection.clipmapTiers;
}

export function createWaterGui(gui: GUI, deps: WaterGuiDeps): void {
  const visual = deps.makeWaterVisual();

  const rebuildVisual = () => {
    deps.waterController.updateVisual(visual);
  };

  const setDebugMode = (mode: WaterDebugModeKey) => {
    deps.waterDebugState.mode = mode;
    deps.setWaterDebugMode(mode);
    deps.waterController.setDebugMode(mode);
  };

  addWaterDebugFolder(gui, deps.waterDebugState, {
    onEnabled: (enabled) => {
      deps.setWaterEnabled(enabled);
      deps.waterController.setVisible(enabled);
    },
    onMode: setDebugMode,
    onClipmapTint: (enabled) => {
      deps.setWaterClipmapTint(enabled);
      deps.waterController.setClipmapTint(enabled);
    },
    onWireframe: (enabled) => {
      deps.setWaterWireframe(enabled);
      deps.waterController.setWireframe(enabled);
    },
    onDepthWrite: (on) => {
      deps.setWaterDepthWrite(on);
      visual.depthWrite = on;
      rebuildVisual();
    },
    onShoreSurfEnabled: (enabled) => deps.waterController.setShoreSurfEnabled(enabled),
    onShoreSurfStartDistance: (distance) => deps.waterController.setShoreSurfStartDistance(distance),
    onShoreSurfFullDistance: (distance) => deps.waterController.setShoreSurfFullDistance(distance),
    onShoreSurfMaxDepth: (depth) => deps.waterController.setShoreSurfMaxDepth(depth),
    onRiverMistEnabled: (enabled) => deps.waterController.setRiverMistEnabled(enabled),
    onRebuildVisual: rebuildVisual,
    getRiverStats: () => riverStats(deps.waterController),
    getCascadeParticleStats: () => deps.waterController.getCascadeParticleStats(),
  });

  addWaterEffectsGui(gui, {
    waterController: deps.waterController,
    onVisualChanged: () => syncWaterEffectVisual(visual, deps.makeWaterVisual()),
  });
  addDeepWaterLookFolder(gui, visual, rebuildVisual);
  addWaterRefractionFolder(gui, visual, rebuildVisual, setDebugMode);
}
