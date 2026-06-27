import { CONSTRUCTION_MATERIAL_ASSETS, CONSTRUCTION_MATERIAL_OPTIONS } from "./material_assets.js";
import type { ConstructionMaterial } from "./types.js";

const PRELOAD_NEIGHBOR_COUNT = 1;
const WORKER_ERROR_LOG_LIMIT = 3;

interface PreloadRequest {
  type: "preload";
  urls: string[];
}

interface PreloadResult {
  type: "preload-complete";
  loaded: string[];
  failed: string[];
}

let preloadWorker: Worker | null | undefined;
let workerErrorCount = 0;
const requestedUrls = new Set<string>();

function materialPbrUrls(material: ConstructionMaterial): string[] {
  const asset = CONSTRUCTION_MATERIAL_ASSETS[material];
  return Object.values(asset.textures).filter((url): url is string => typeof url === "string" && url.length > 0);
}

function materialWindowIndexes(selectedIndex: number): number[] {
  const count = CONSTRUCTION_MATERIAL_OPTIONS.length;
  const indexes: number[] = [];
  for (let offset = -PRELOAD_NEIGHBOR_COUNT; offset <= PRELOAD_NEIGHBOR_COUNT; offset += 1) {
    indexes.push(((selectedIndex + offset) % count + count) % count);
  }
  return [...new Set(indexes)];
}

function browserPreload(urls: readonly string[]): void {
  for (const url of urls) {
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = url;
  }
}

function logWorkerError(message: string, error: unknown): void {
  if (workerErrorCount >= WORKER_ERROR_LOG_LIMIT) return;
  workerErrorCount += 1;
  console.warn(message, error);
}

function worker(): Worker | null {
  if (preloadWorker !== undefined) return preloadWorker;
  try {
    preloadWorker = new Worker(new URL("./material_preloader.worker.ts", import.meta.url), { type: "module" });
    preloadWorker.onmessage = (event: MessageEvent<PreloadResult>) => {
      if (event.data.type !== "preload-complete" || event.data.failed.length === 0) return;
      console.warn(`[construction] material worker failed to preload ${event.data.failed.length} texture(s)`);
    };
    preloadWorker.onerror = (event) => {
      logWorkerError("[construction] material preload worker failed; falling back to browser image cache", event.message);
      preloadWorker?.terminate();
      preloadWorker = null;
    };
  } catch (error) {
    logWorkerError("[construction] material preload worker unavailable; falling back to browser image cache", error);
    preloadWorker = null;
  }
  return preloadWorker;
}

function preloadUrls(urls: readonly string[]): void {
  const pending = urls.filter((url) => {
    if (requestedUrls.has(url)) return false;
    requestedUrls.add(url);
    return true;
  });
  if (pending.length === 0) return;

  const activeWorker = worker();
  if (activeWorker) {
    const request: PreloadRequest = { type: "preload", urls: pending };
    activeWorker.postMessage(request);
    return;
  }
  browserPreload(pending);
}

export function preloadConstructionMaterialPreviews(): void {
  preloadUrls(CONSTRUCTION_MATERIAL_OPTIONS.map((option) => option.previewUrl));
}

export function preloadConstructionMaterialPbr(materials: readonly ConstructionMaterial[]): void {
  preloadUrls(materials.flatMap(materialPbrUrls));
}

export function preloadConstructionMaterialWindow(selectedIndex: number): void {
  const materialIds = materialWindowIndexes(selectedIndex).map((index) => CONSTRUCTION_MATERIAL_OPTIONS[index]!.id);
  preloadConstructionMaterialPbr(materialIds);
}
