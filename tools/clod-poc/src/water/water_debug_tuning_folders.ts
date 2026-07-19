import type GUI from "lil-gui";
import {
  readRiverCascadeParticleSettings,
  reloadWithRiverCascadeParticleSettings,
  type RiverCascadeParticleSettings,
} from "./riverCascadeParticlesRuntime.js";
import {
  readRiverEcologySettings,
  reloadWithRiverEcologySettings,
  type RiverEcologySettings,
} from "./riverEcologyRuntime.js";
import {
  readRiverMaterialSettings,
  reloadWithRiverMaterialSettings,
  type RiverMaterialSettings,
} from "./riverMaterialRuntime.js";

export function addRiverEcologyTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("river ecology tuning");
  const settings: RiverEcologySettings = readRiverEcologySettings();

  folder.add(settings, "grassClearanceM", 0.05, 2.5, 0.05).name("grass clear m");
  folder.add(settings, "grassLowStartM", 0.1, 6.0, 0.1).name("grass low start");
  folder.add(settings, "grassLowEndM", 0.5, 12.0, 0.1).name("grass low end");
  folder.add(settings, "grassMoistStartM", 0.5, 16.0, 0.1).name("grass moist start");
  folder.add(settings, "grassMoistEndM", 2.0, 32.0, 0.5).name("grass moist end");
  folder.add(settings, "understoryClearM", 0.05, 3.0, 0.05).name("understory clear");
  folder.add(settings, "understoryFernStartM", 0.2, 8.0, 0.1).name("fern start");
  folder.add(settings, "understoryFernEndM", 2.0, 18.0, 0.5).name("fern end");
  folder.add(settings, "understoryShrubStartM", 2.0, 18.0, 0.5).name("shrub start");
  folder.add(settings, "understoryShrubEndM", 6.0, 36.0, 0.5).name("shrub end");
  folder.add(settings, "treeClearanceM", 0.5, 8.0, 0.1).name("tree clear");
  folder.add(settings, "treeInnerEndM", 2.0, 24.0, 0.5).name("tree inner end");
  folder.add(settings, "treeOuterStartM", 4.0, 40.0, 0.5).name("tree outer start");
  folder.add(settings, "treeOuterEndM", 12.0, 80.0, 1.0).name("tree outer end");
  folder.add(settings, "stoneClearanceM", 0.02, 2.0, 0.02).name("stone clear");
  folder.add({ apply: () => reloadWithRiverEcologySettings(settings) }, "apply").name("apply + rebuild");

  return { refresh: () => refreshFolder(folder) };
}

export function addRiverMaterialTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("river material tuning");
  const settings: RiverMaterialSettings = readRiverMaterialSettings();

  folder.add(settings, "geometryThalwegDip", 0, 0.35, 0.005).name("thalweg dip");
  folder.add(settings, "geometryBankLift", 0, 0.25, 0.005).name("bank lift");
  folder.add(settings, "geometryRiffleStrength", 0, 0.30, 0.005).name("riffle strength");
  folder.add(settings, "geometrySideRiffleStrength", 0, 0.20, 0.005).name("side riffle");
  folder.add(settings, "geometryMaxOffset", 0, 0.60, 0.01).name("max geom offset");
  folder.add(settings, "cascadeDropStart", 0, 8, 0.05).name("cascade drop start");
  folder.add(settings, "cascadeDropEnd", 0.05, 16, 0.05).name("cascade drop end");
  folder.add(settings, "cascadeStepStrength", 0, 0.60, 0.005).name("cascade step");
  folder.add(settings, "cascadeRoughnessStrength", 0, 0.40, 0.005).name("cascade rough");
  folder.add(settings, "cascadeWhitewaterBoost", 0, 5, 0.05).name("whitewater boost");
  folder.add(settings, "wetBankStrength", 0, 2, 0.05).name("wet bank decals");
  folder.add(settings, "wetBankDistanceM", 0.5, 24, 0.5).name("wet bank distance");
  folder.add(settings, "wetRockDarkening", 0, 1, 0.02).name("wet rock darken");
  folder.add(settings, "foamResidueStrength", 0, 2, 0.05).name("foam residue");
  folder.add(settings, "foamResidueDropStart", 0, 12, 0.05).name("foam drop start");
  folder.add(settings, "foamResidueDropEnd", 0.05, 24, 0.05).name("foam drop end");
  folder.add(settings, "bankNormalStrength", 0, 3, 0.05).name("bank normal");
  folder.add(settings, "rapidScale", 0.02, 1.0, 0.01).name("rapid scale");
  folder.add(settings, "crossCurrentStrength", 0, 4, 0.05).name("cross current");
  folder.add(settings, "rapidNormalBoost", 0, 4, 0.05).name("rapid normal");
  folder.add(settings, "bankFoamStrength", 0, 3, 0.05).name("bank foam");
  folder.add(settings, "rapidFoamStrength", 0, 3, 0.05).name("rapid foam");
  folder.add(settings, "foamStreakStrength", 0, 3, 0.05).name("foam streaks");
  folder.add(settings, "shallowBankTintStrength", 0, 3, 0.05).name("shallow tint");
  folder.add(settings, "centerChannelDarkening", 0, 3, 0.05).name("center darken");
  folder.add({ apply: () => reloadWithRiverMaterialSettings(settings) }, "apply").name("apply + rebuild");

  return { refresh: () => refreshFolder(folder) };
}

export function addRiverCascadeParticleTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("cascade mist / splash");
  const settings: RiverCascadeParticleSettings = readRiverCascadeParticleSettings();

  folder.add(settings, "enabled").name("enabled");
  folder.add(settings, "mistStrength", 0, 3, 0.05).name("mist strength");
  folder.add(settings, "splashStrength", 0, 3, 0.05).name("splash strength");
  folder.add(settings, "foamDriftStrength", 0, 3, 0.05).name("foam drift");
  folder.add(settings, "spawnRadiusM", 16, 180, 1).name("spawn radius");
  folder.add(settings, "maxEmittersPerTick", 4, 80, 1).name("max emitters");
  folder.add(settings, "rapidSpeedStart", 0.05, 8, 0.05).name("rapid start");
  folder.add(settings, "rapidSpeedEnd", 0.10, 12, 0.05).name("rapid end");
  folder.add(settings, "dropStart", 0, 12, 0.05).name("drop start");
  folder.add(settings, "dropEnd", 0.05, 24, 0.05).name("drop end");
  folder.add({ apply: () => reloadWithRiverCascadeParticleSettings(settings) }, "apply").name("apply + rebuild");

  return { refresh: () => refreshFolder(folder) };
}

function refreshFolder(folder: GUI): void {
  folder.controllers.forEach((controller) => controller.updateDisplay());
}
