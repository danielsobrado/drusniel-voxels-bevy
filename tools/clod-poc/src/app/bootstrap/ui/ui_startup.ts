import { createUiStartupContext, type UiStartupInput } from "../ui_startup_context.js";
import { createInfoPanelController } from "../info_panel_startup.js";
import { runTerrainEditStartup } from "./terrain_edit_startup.js";
import { runGuiStartup } from "./gui_startup.js";
import { runTextureUiStartup } from "./texture_ui_startup.js";
import { runProjectArchiveStartup } from "../project_archive_startup.js";
import { applyImportedStateSideEffects } from "./imported_state_startup.js";
import { runFrameLoopStartup } from "./frame_loop_startup.js";
import { bindBootstrapDisposal } from "../disposal_startup.js";

export type { UiStartupInput } from "../ui_startup_context.js";

export async function runUiStartup(input: UiStartupInput): Promise<void> {
  const ctx = createUiStartupContext(input);

  input.runtime.updateLighting();
  input.terrainView.updateSelection();

  const infoPanel = createInfoPanelController(ctx);
  const terrainEdit = runTerrainEditStartup(ctx, infoPanel);
  const gui = runGuiStartup(ctx, infoPanel);
  await runTextureUiStartup(ctx, infoPanel, gui, terrainEdit);
  runProjectArchiveStartup(ctx, infoPanel, terrainEdit);
  applyImportedStateSideEffects(ctx, infoPanel);
  runFrameLoopStartup(ctx, infoPanel, terrainEdit);
  bindBootstrapDisposal(ctx);
}
