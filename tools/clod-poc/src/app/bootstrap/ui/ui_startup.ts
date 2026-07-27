import { completeProjectImportRecovery } from "../../../project/project_import_recovery.js";
import { createUiStartupContext, type UiStartupInput } from "../ui_startup_context.js";
import { createInfoPanelController } from "../info_panel_startup.js";
import { runTerrainEditStartup } from "./terrain_edit_startup.js";
import { runGuiStartup } from "./gui_startup.js";
import { runTextureUiStartup } from "./texture_ui_startup.js";
import { runSpellUiStartup } from "./spell_ui_startup.js";
import { runPropEditUiStartup } from "./prop_edit_ui_startup.js";
import { runProjectArchiveStartup } from "../project_archive_startup.js";
import { applyImportedStateSideEffects } from "./imported_state_startup.js";
import { runFrameLoopStartup } from "./frame_loop_startup.js";
import { bindBootstrapDisposal } from "../disposal_startup.js";
import "../../../ui/hud_layout.css";
import { createCircularMinimap } from "../../../ui/minimap.js";

export type { UiStartupInput } from "../ui_startup_context.js";

function minimapEnabled(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get("minimap");
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export async function runUiStartup(input: UiStartupInput): Promise<void> {
  const ctx = createUiStartupContext(input);

  input.runtime.updateLighting();
  input.terrainView.updateSelection();

  const infoPanel = createInfoPanelController(ctx);
  const terrainEdit = runTerrainEditStartup(ctx, infoPanel);
  const gui = runGuiStartup(ctx, infoPanel);
  await runTextureUiStartup(ctx, infoPanel, gui, terrainEdit);
  runSpellUiStartup(ctx, terrainEdit);
  runPropEditUiStartup(ctx, gui.gui);
  runProjectArchiveStartup(ctx, infoPanel, terrainEdit);
  applyImportedStateSideEffects(ctx, infoPanel);

  if (minimapEnabled(input.searchParams)) {
    const cells = Number(input.searchParams.get("minimapCells") ?? 192);
    const minimap = createCircularMinimap({
      cells: Number.isFinite(cells) && cells > 0 ? cells : 192,
      getPose: () => input.longView.hooks?.getPose?.() ?? window.__drusnielClod?.getPose?.() ?? null,
    });
    let raf = 0;
    const tick = () => {
      minimap.tick();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("beforeunload", () => {
      cancelAnimationFrame(raf);
      minimap.dispose();
    }, { once: true });
  }

  runFrameLoopStartup(ctx, infoPanel, terrainEdit);
  bindBootstrapDisposal(ctx);
  if (input.stagedImport) completeProjectImportRecovery();
}
