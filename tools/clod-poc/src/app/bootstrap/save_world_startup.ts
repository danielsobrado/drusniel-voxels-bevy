import { emitAudio } from "../../audio/index.js";
import { loadSavedWorldFromQuery, type LoadedSavedWorld } from "../../save/save_service.js";

export interface SaveWorldStartupDom {
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
}

export async function loadSavedWorldStartup(
  searchParams: URLSearchParams,
  dom: SaveWorldStartupDom,
): Promise<LoadedSavedWorld | null> {
  if (!searchParams.get("save")) return null;

  dom.buildProgress.hidden = false;
  dom.buildProgressPhase.textContent = "loading saved world";
  dom.buildProgressPercent.textContent = "0%";
  dom.buildProgressBar.value = 0;

  try {
    const savedWorld = await loadSavedWorldFromQuery(searchParams, {
      replaceVoxelSnapshot: () => undefined,
    });
    if (!savedWorld) return null;
    dom.buildProgressPercent.textContent = "100%";
    dom.buildProgressBar.value = 1;
    emitAudio("project.import.success");
    return savedWorld;
  } catch (error) {
    emitAudio("project.import.error");
    dom.info.textContent = `Saved world load failed: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}
