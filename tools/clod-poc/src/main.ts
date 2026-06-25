import { bootstrapClodPoc } from "./app/bootstrap/index.js";

bootstrapClodPoc().catch((e) => {
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  throw e;
});
