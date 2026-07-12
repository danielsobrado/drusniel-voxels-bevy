import { bootstrapClodPoc } from "./app/bootstrap/index.js";
import { installConstructionBuildMenuLayout } from "./construction/build_menu_style.js";
import { installConstructionGhostEffect } from "./construction/ghost_effect.js";
import { installHeightfieldTileClientRuntime } from "./world/heightfield_tiles/heightfield_tile_client_runtime.js";

installConstructionBuildMenuLayout();
installConstructionGhostEffect();
installHeightfieldTileClientRuntime();

bootstrapClodPoc().catch((error) => {
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;

  const info = document.getElementById("info");
  if (info) {
    info.textContent = `build failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  console.error(error);
});
