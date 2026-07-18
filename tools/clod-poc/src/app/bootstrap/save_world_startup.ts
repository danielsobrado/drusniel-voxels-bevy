import { emitAudio } from "../../audio/index.js";
import { initSaveRuntime } from "../../save/save_runtime.js";
import { installSavedWorldManifestCompatibilityGuard } from "../../save/saved_world_startup_compatibility.js";
import { readSavedWorldForStartup } from "../../save/saved_world_startup_reader.js";
import { seedOverrideFromQuery, type LoadedSavedWorld } from "../../save/save_service.js";
import { replaceVoxelEdits } from "../../terrain/terrain.js";

export interface SaveWorldStartupDom {
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
}

export async function loadSavedWorldStartup(searchParams: URLSearchParams, dom: SaveWorldStartupDom): Promise<LoadedSavedWorld | null> {
  if (!searchParams.get("save")) return null;
  dom.buildProgress.hidden = false;
  dom.buildProgressPhase.textContent = "loading saved world";
  dom.buildProgressPercent.textContent = "0%";
  dom.buildProgressBar.value = 0;
  let disposeManifestGuard: (() => void) | null = null;
  try {
    const savedWorld = await readSavedWorldForStartup(searchParams);
    if (!savedWorld) return null;
    if (seedOverrideFromQuery(searchParams) === undefined) searchParams.set("seed", String(savedWorld.manifest.seed));
    if (savedWorld.propInstanceCount > 0 && searchParams.get("customProps") !== "0") searchParams.set("customProps", "1");
    disposeManifestGuard = installSavedWorldManifestCompatibilityGuard(window, savedWorld.manifest);
    initSaveRuntime(savedWorld);
    replaceVoxelEdits(savedWorld.voxelSnapshot);
    disposeManifestGuard = null;
    dom.buildProgressPercent.textContent = "100%";
    dom.buildProgressBar.value = 1;
    emitAudio("project.import.success");
    return savedWorld;
  } catch (error) {
    disposeManifestGuard?.();
    emitAudio("project.import.error");
    dom.info.textContent = `Saved world load failed: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}
