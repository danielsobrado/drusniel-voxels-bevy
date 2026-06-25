import { emitAudio } from "../../audio/index.js";
import {
  consumeStagedProjectImport,
  type ProjectArchiveContents,
} from "../../project_archive.js";

export interface ProjectImportDom {
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  info: HTMLElement;
}

export async function loadStagedProjectImport(
  searchParams: URLSearchParams,
  dom: ProjectImportDom,
): Promise<ProjectArchiveContents | null> {
  const importToken = searchParams.get("import");
  if (!importToken) return null;

  dom.buildProgress.hidden = false;
  dom.buildProgressPhase.textContent = "loading imported project";
  dom.buildProgressPercent.textContent = "0%";
  dom.buildProgressBar.value = 0;
  try {
    const stagedImport = await consumeStagedProjectImport(importToken);
    if (!stagedImport) throw new Error("The staged project was not found or was already used");
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
