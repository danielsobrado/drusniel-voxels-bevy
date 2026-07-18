import { emitAudio } from "../../audio/index.js";
import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import { validateProjectArchiveConfig } from "../../project/project_archive_config.js";
import {
  validateProjectWaterArchiveState,
  validateProjectWeatherArchiveState,
} from "../../project/project_archive_environment_state.js";
import { validateProjectSessionState } from "../../project/project_archive_session_state.js";
import {
  consumeStagedVoxelProjectImport,
  isCurrentVoxelProjectManifest,
  type VoxelProjectArchiveContents,
} from "../../project/voxel_project_archive.js";
import { applyProjectGeneratorQuery } from "../../project/project_world_identity.js";
import { loadSavedWorldStartup } from "./save_world_startup.js";

export interface ProjectImportDom {
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
}

function setBooleanParam(searchParams: URLSearchParams, key: string, value: boolean): void {
  searchParams.set(key, value ? "1" : "0");
}

function applyStagedWorldIdentity(
  searchParams: URLSearchParams,
  stagedImport: VoxelProjectArchiveContents,
): void {
  const { manifest } = stagedImport;
  if (!isCurrentVoxelProjectManifest(manifest)) {
    console.warn("[project import] legacy schema v3 has no pinned world identity; using current URL world settings");
    return;
  }
  if (manifest.world.generatorVersion !== TERRAIN_SOURCE_VERSION) {
    throw new Error(
      `Project generator ${manifest.world.generatorVersion} is incompatible with ${TERRAIN_SOURCE_VERSION}`,
    );
  }
  const { terrainField } = manifest.world;
  const { islandShape } = terrainField;
  applyProjectGeneratorQuery(searchParams, manifest.world.generatorQuery);
  searchParams.set("scene", manifest.world.scene);
  searchParams.set("seed", String(terrainField.seed));
  searchParams.set("seaLevel", String(terrainField.seaLevel));
  setBooleanParam(searchParams, "islands", islandShape.enabled);
  setBooleanParam(searchParams, "oceanRim", islandShape.oceanRim);
  searchParams.set("worldRadius", String(islandShape.worldRadiusM));
  searchParams.set("islandSpacing", String(islandShape.spacingM));
  searchParams.set("islandRadius", String(islandShape.radiusM));
  searchParams.set("islandBlend", String(islandShape.blendM));
}

export async function loadStagedProjectImport(
  searchParams: URLSearchParams,
  dom: ProjectImportDom,
): Promise<VoxelProjectArchiveContents | null> {
  const importToken = searchParams.get("import");
  if (!importToken) {
    await loadSavedWorldStartup(searchParams, dom);
    return null;
  }

  dom.buildProgress.hidden = false;
  dom.buildProgressPhase.textContent = "loading imported project";
  dom.buildProgressPercent.textContent = "0%";
  dom.buildProgressBar.value = 0;
  try {
    const stagedImport = await consumeStagedVoxelProjectImport(importToken);
    if (!stagedImport) throw new Error("The staged project was not found, expired, or was already used");
    stagedImport.manifest.config = validateProjectArchiveConfig(stagedImport.manifest.config);
    stagedImport.manifest.state = validateProjectSessionState(stagedImport.manifest.state);
    stagedImport.manifest.water = validateProjectWaterArchiveState(stagedImport.manifest.water);
    stagedImport.manifest.weather = validateProjectWeatherArchiveState(stagedImport.manifest.weather);
    applyStagedWorldIdentity(searchParams, stagedImport);
    emitAudio("project.import.success");
    return stagedImport;
  } catch (error) {
    emitAudio("project.import.error");
    dom.info.textContent = `Project import failed: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  } finally {
    searchParams.delete("import");
    const query = searchParams.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
}
