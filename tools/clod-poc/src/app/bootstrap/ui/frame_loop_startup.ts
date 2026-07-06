import type { InfoPanelController } from "../../ui/info_panel.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export type { StatsPresenter } from "../../frame_loop/stats_presenter.js";

export function runFrameLoopStartup(
  _ctx: UiStartupContext,
  _infoPanel: InfoPanelController,
  _terrainEdit: TerrainEditStartupResult,
): void {
  throw new Error("frame_loop_startup.ts was not restored correctly");
}
