import { bootstrapClodPoc } from "./app/bootstrap/index.js";

bootstrapClodPoc().catch((error) => {
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;

  const info = document.getElementById("info");
  if (info) {
    info.textContent = `build failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  console.error(error);
});
