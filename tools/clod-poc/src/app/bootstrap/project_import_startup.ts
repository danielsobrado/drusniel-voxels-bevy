import { emitAudio } from "../../audio/index.js";
import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import {
  consumeStagedVoxelProjectImport,
  isCurrentVoxelProjectManifest,
  type VoxelProjectArchiveContents,
} from "../../project/voxel_project_archive.js";
import { loadSavedWorldStartup } from "./save_world_startup.js";

export interface ProjectImportDom {
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
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
  searchParams.set("scene", manifest.world.scene);
  searchParams.set("seed", String(manifest.world.terrainField.seed));
  searchParams.set("seaLevel", String(manifest.world.terrainField.seaLevel));
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
