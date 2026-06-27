import type GUI from "lil-gui";
import {
  addWaterDebugFolder,
  WATER_DEBUG_MODES,
  type WaterDebugState,
  type WaterRiverDebugStats,
} from "../../water/index.js";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";

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

  addColorControl(folder, "deep color", visual.deepColor, (next) => {
    visual.deepColor = next;
    rebuild();
  });

  addColorControl(folder, "shallow teal", visual.shallowColor, (next) => {
    visual.shallowColor = next;
    rebuild();
  });

  addColorControl(folder, "foam color", visual.foamColor, (next) => {
    visual.foamColor = next;
    rebuild();
  });

  folder.add(visual, "alpha", 0.35, 1.0, 0.01).name("alpha").onChange(rebuild);
  folder.add(visual.color, "depthScale", 0.5, 16.0, 0.1).name("depth scale").onChange(rebuild);
  folder.add(visual.color, "turbidity", 0.0, 0.8, 0.01).name("turbidity").onChange(rebuild);

  folder.add(visual.fresnel, "base", 0.0, 0.35, 0.005).name("fresnel base").onChange(rebuild);
  folder.add(visual.fresnel, "power", 1.0, 9.0, 0.1).name("fresnel power").onChange(rebuild);
  folder.add(visual.fresnel, "normalFlatten", 0.0, 1.0, 0.01).name("normal flatten").onChange(rebuild);

  folder.add(visual, "rippleAmp", 0.0, 3.0, 0.01).name("wave normal amp").onChange(rebuild);
  folder.add(visual, "rippleSpeed", 0.0, 2.0, 0.01).name("wave speed").onChange(rebuild);
  folder.add(visual, "rippleScaleA", 0.02, 0.5, 0.005).name("wave scale A").onChange(rebuild);
  folder.add(visual, "rippleScaleB", 0.02, 0.5, 0.005).name("wave scale B").onChange(rebuild);
  folder.add(visual, "rippleStrengthA", 0.0, 0.8, 0.01).name("normal str A").onChange(rebuild);
  folder.add(visual, "rippleStrengthB", 0.0, 0.8, 0.01).name("normal str B").onChange(rebuild);

  folder.add(visual.reflection, "skyFallbackStrength", 0.0, 2.0, 0.01).name("sky reflect").onChange(rebuild);
  folder.add(visual.reflection, "terrainFallbackStrength", 0.0, 1.0, 0.01).name("terrain reflect").onChange(rebuild);

  folder.add(visual.foam, "noiseScale", 0.01, 0.25, 0.005).name("foam noise").onChange(rebuild);
  folder.add(visual.foam, "shoreStrength", 0.0, 2.0, 0.01).name("shore foam").onChange(rebuild);
  folder.add(visual.foam, "riverStrength", 0.0, 2.0, 0.01).name("river foam").onChange(rebuild);
}

export function createWaterGui(gui: GUI, deps: WaterGuiDeps): void {
  const visual = deps.makeWaterVisual();

  const rebuildVisual = () => {
    deps.waterController.updateVisual(visual);
  };

  addWaterDebugFolder(gui, deps.waterDebugState, {
    onEnabled: (enabled) => {
      deps.setWaterEnabled(enabled);
      deps.waterController.setVisible(enabled);
    },
    onMode: (mode) => {
      deps.setWaterDebugMode(mode);
      deps.waterController.setDebugMode(mode);
    },
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
    onRebuildVisual: rebuildVisual,
    getRiverStats: () => riverStats(deps.waterController),
  });

  addDeepWaterLookFolder(gui, visual, rebuildVisual);
}
