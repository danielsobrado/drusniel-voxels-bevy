import type { InfoPanelController } from "../../ui/info_panel.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export type { StatsPresenter } from "../../frame_loop/stats_presenter.js";

export function runFrameLoopStartup(
  _ctx: UiStartupContext,
  _infoPanel: InfoPanelController,
  _terrainEdit: TerrainEditStartupResult,
): void {
  throw new Error("frame_loop_startup.ts must be restored from commit 5e7170bd2c8b4705c50aceae25050565498ac5f0 before continuing feature work");
}
