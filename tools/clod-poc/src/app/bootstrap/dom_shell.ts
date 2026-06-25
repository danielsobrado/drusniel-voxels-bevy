import { createClodOverlay } from "../../ui/overlay_panel.js";
import { setButtonIcon, setIconOnlyButton } from "../../ui/dom_icons.js";

export interface DomShell {
  info: HTMLElement;
  infoPanel: HTMLElement;
  importButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  projectImportInput: HTMLInputElement;
  orbitModeButton: HTMLButtonElement;
  playerModeButton: HTMLButtonElement;
  playerModeStatus: HTMLElement;
  buildProgress: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
}

export function initDomShell(): DomShell {
  const info = document.getElementById("info")!;
  const infoPanel = document.getElementById("info-panel")!;
  const infoClose = document.getElementById("info-close") as HTMLButtonElement;
  const infoReopen = document.getElementById("info-reopen") as HTMLButtonElement;
  const setInfoPanelVisible = (visible: boolean) => {
    infoPanel.hidden = !visible;
    infoReopen.hidden = visible;
  };
  infoClose.addEventListener("click", () => setInfoPanelVisible(false));
  infoReopen.addEventListener("click", () => setInfoPanelVisible(true));
  createClodOverlay(document.getElementById("clod-overlay")!);

  const importButton = document.getElementById("project-import") as HTMLButtonElement;
  const exportButton = document.getElementById("project-export") as HTMLButtonElement;
  const projectImportInput = document.getElementById("project-import-input") as HTMLInputElement;
  const orbitModeButton = document.getElementById("orbit-mode") as HTMLButtonElement;
  const playerModeButton = document.getElementById("player-mode") as HTMLButtonElement;
  const playerModeStatus = document.getElementById("player-mode-status")!;
  const buildProgress = document.getElementById("build-progress")!;
  const buildProgressBar = document.getElementById("build-progress-bar") as HTMLProgressElement;
  const buildProgressPhase = document.getElementById("build-progress-phase")!;
  const buildProgressPercent = document.getElementById("build-progress-percent")!;

  setIconOnlyButton(importButton, "project", "import", "Import project");
  setIconOnlyButton(exportButton, "project", "export", "Export project");
  setButtonIcon(orbitModeButton, "camera", "orbit", "Orbit");
  setButtonIcon(playerModeButton, "camera", "player", "Player");

  return {
    info,
    infoPanel,
    importButton,
    exportButton,
    projectImportInput,
    orbitModeButton,
    playerModeButton,
    playerModeStatus,
    buildProgress,
    buildProgressBar,
    buildProgressPhase,
    buildProgressPercent,
  };
}
