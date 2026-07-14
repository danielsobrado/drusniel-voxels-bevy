export type GrassGpuPresentation = "unavailable" | "warming" | "rendering";

export function resolveGrassGpuPresentation(
  updateAccepted: boolean,
  hasVisibleDraw: boolean,
): GrassGpuPresentation {
  if (!updateAccepted) return "unavailable";
  return hasVisibleDraw ? "rendering" : "warming";
}
