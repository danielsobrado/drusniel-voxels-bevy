import type GUI from "lil-gui";
import type { RiverCascadeParticleStats } from "./riverCascadeParticleOverlay.js";
import { riverEcologyReadout } from "./riverEcologyRuntime.js";
import { setWaterDebugMode } from "./water_debug_modes.js";
import type {
  WaterDebugBindings,
  WaterDebugState,
  WaterRiverDebugStats,
} from "./water_debug_types.js";

export function makeEmptyRiverStats(): WaterRiverDebugStats {
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

export function makeEmptyCascadeParticleStats(): RiverCascadeParticleStats {
  return {
    mist: 0,
    splash: 0,
    foam: 0,
    lastEmitters: 0,
    lastCascadeEmitters: 0,
    lastRapidEmitters: 0,
    lastMaxCascade: 0,
    lastMaxRapid: 0,
  };
}

export function addRiverStatsFolder(
  parent: GUI,
  bindings: WaterDebugBindings,
): { refresh: () => void } {
  const folder = parent.addFolder("river stats");
  const stats = makeEmptyRiverStats();
  const refresh = () => Object.assign(
    stats,
    bindings.getRiverStats?.() ?? makeEmptyRiverStats(),
  );
  refresh();

  folder.add(stats, "source").name("source").disable();
  folder.add(stats, "hydrologyEnabled").name("hydrology").disable();
  folder.add(stats, "riverCells").name("river cells").disable();
  folder.add(stats, "lakeCells").name("lake cells").disable();
  folder.add(stats, "wetCells").name("wet cells").disable();
  folder.add(stats, "maxFlowSpeed").name("max flow").disable();
  folder.add(stats, "fallbackRivers").name("fallback used").disable();
  folder.add(stats, "fallbackMainRiver").name("trunk enabled").disable();
  folder.add(stats, "fallbackTributaries").name("tributaries").disable();
  folder.add(stats, "widenRadius").name("width / widen").disable();
  folder.add(stats, "carveDepthM").name("carve depth").disable();
  folder.add(stats, "visibleDepthM").name("visible depth").disable();
  folder.add(stats, "flowSpeedMultiplier").name("flow speed x").disable();
  folder.add(stats, "fakeRiverCount").name("fake rivers").disable();
  folder.add({ refresh }, "refresh").name("refresh stats");

  return { refresh: () => refreshFolder(folder, refresh) };
}

export function addCascadeParticleStatsFolder(
  parent: GUI,
  bindings: WaterDebugBindings,
): { refresh: () => void } {
  const folder = parent.addFolder("cascade particle stats");
  const stats = makeEmptyCascadeParticleStats();
  const refresh = () => Object.assign(
    stats,
    bindings.getCascadeParticleStats?.() ?? makeEmptyCascadeParticleStats(),
  );
  refresh();

  folder.add(stats, "mist").name("mist count").disable();
  folder.add(stats, "splash").name("splash count").disable();
  folder.add(stats, "foam").name("foam drift count").disable();
  folder.add(stats, "lastEmitters").name("last emitters").disable();
  folder.add(stats, "lastCascadeEmitters").name("cascade emitters").disable();
  folder.add(stats, "lastRapidEmitters").name("rapid emitters").disable();
  folder.add(stats, "lastMaxCascade").name("max cascade").disable();
  folder.add(stats, "lastMaxRapid").name("max rapid").disable();
  folder.add({ refresh }, "refresh").name("refresh stats");

  return { refresh: () => refreshFolder(folder, refresh) };
}

export function addRiverEcologyDebugFolder(
  parent: GUI,
  state: WaterDebugState,
  bindings: WaterDebugBindings,
): { refresh: () => void } {
  const folder = parent.addFolder("river ecology debug");
  const actions = {
    showFlow: () => setWaterDebugMode(state, bindings, "flow"),
    showFoam: () => setWaterDebugMode(state, bindings, "foam"),
    showDepth: () => setWaterDebugMode(state, bindings, "depth"),
    showFinal: () => setWaterDebugMode(state, bindings, "final"),
  };

  folder.add(actions, "showFlow").name("show flow");
  folder.add(actions, "showFoam").name("show foam");
  folder.add(actions, "showDepth").name("show depth");
  folder.add(actions, "showFinal").name("back to final");

  const readout = riverEcologyReadout();
  folder.add(readout, "grass").name("grass bands").disable();
  folder.add(readout, "understory").name("understory bands").disable();
  folder.add(readout, "trees").name("tree bands").disable();
  folder.add(readout, "stones").name("stone bands").disable();

  return {
    refresh: () => refreshFolder(folder, () => {
      Object.assign(readout, riverEcologyReadout());
    }),
  };
}

function refreshFolder(folder: GUI, refresh: () => void): void {
  refresh();
  folder.controllers.forEach((controller) => controller.updateDisplay());
}
