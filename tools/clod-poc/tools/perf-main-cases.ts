export interface PerfMainCase {
  name: string;
  params: Record<string, string>;
}

export const PERF_MAIN_CASES: readonly PerfMainCase[] = [
  { name: "infinite-islands", params: { scene: "infinite-islands", freeze: "0" } },
  { name: "current-textured", params: {} },
  { name: "debug-flat", params: { terrainMaterial: "debug_flat", terrainTriplanar: "0" } },
  { name: "triplanar-off", params: { terrainTriplanar: "0" } },
  { name: "tree-gpu-ring", params: { treeGpu: "1" } },
  { name: "tree-gpu-strict", params: { treeGpuStrict: "1" } },
  { name: "tree-gpu-strict-counts", params: { treeGpuStrict: "1", treeGpuCounts: "1" } },
  { name: "tree-gpu-force-cpu", params: { treeGpuForceCpu: "1" } },
  { name: "tree-gpu-off", params: { treeGpu: "0" } },
  { name: "tree-gpu-visible-12k", params: { treeGpu: "1", treeGpuMaxVisible: "12000" } },
  { name: "tree-gpu-visible-9k", params: { treeGpu: "1", treeGpuMaxVisible: "9000" } },
  { name: "tree-distance-360", params: { treeGpu: "1", treeDistance: "360" } },
  { name: "tree-shadows-none", params: { treeGpuStrict: "1", treeShadowMaxLod: "none" } },
  { name: "trees-off", params: { trees: "0", understory: "0" } },
  { name: "grass-off", params: { grass: "0" } },
  { name: "stones-off", params: { stones: "0" } },
  { name: "vegetation-off", params: { grass: "0", trees: "0", stones: "0", understory: "0", weather: "off" } },
  { name: "water-weather-off", params: { water: "0", weather: "off" } },
  { name: "far-shell-off", params: { farShell: "0" } },
  { name: "terrain-material-cache-enabled", params: { scene: "infinite-naadf-far", terrainMaterialCache: "1" } },
  { name: "terrain-material-cache-disabled", params: { scene: "infinite-naadf-far", terrainMaterialCache: "0" } },
  { name: "terrain-material-cache-debug", params: { scene: "infinite-naadf-far", terrainMaterialCache: "1", terrainMaterialCacheDebug: "far_color" } },
  { name: "selection-cpu", params: { webgpuSelection: "0" } },
  { name: "clod-perf-mode", params: { clodPerf: "1" } },
];

export function selectPerfMainCases(
  rawCase: string | undefined,
  cases: readonly PerfMainCase[] = PERF_MAIN_CASES,
): PerfMainCase[] {
  if (!rawCase) return [...cases];
  const wanted = new Set(rawCase.split(",").map((name) => name.trim()).filter(Boolean));
  const selected = cases.filter((perfCase) => wanted.has(perfCase.name));
  const missing = [...wanted].filter((name) => !cases.some((perfCase) => perfCase.name === name));
  if (missing.length > 0) throw new Error(`Unknown perf case(s): ${missing.join(", ")}`);
  if (selected.length === 0) throw new Error("No perf cases selected");
  return selected;
}
