interface PreloadRequest {
  type: "preload";
  urls: string[];
}

interface PreloadResult {
  type: "preload-complete";
  loaded: string[];
  failed: string[];
}

interface WorkerScope {
  postMessage(message: PreloadResult): void;
  onmessage: ((event: MessageEvent<PreloadRequest>) => void) | null;
}

const workerScope = globalThis as unknown as WorkerScope;
const loadedUrls = new Set<string>();
const inflightUrls = new Map<string, Promise<void>>();

function postResult(result: PreloadResult): void {
  workerScope.postMessage(result);
}

async function decodeBlob(blob: Blob): Promise<void> {
  if (typeof createImageBitmap !== "function") {
    await blob.arrayBuffer();
    return;
  }
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

async function preloadUrl(url: string): Promise<void> {
  if (loadedUrls.has(url)) return;
  const inflight = inflightUrls.get(url);
  if (inflight) return inflight;

  const task = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })
    .then(decodeBlob)
    .then(() => {
      loadedUrls.add(url);
    })
    .finally(() => {
      inflightUrls.delete(url);
    });

  inflightUrls.set(url, task);
  return task;
}

workerScope.onmessage = (event: MessageEvent<PreloadRequest>) => {
  if (event.data.type !== "preload") return;
  const urls = [...new Set(event.data.urls.filter((url) => typeof url === "string" && url.length > 0))];
  Promise.allSettled(urls.map(preloadUrl))
    .then((results) => {
      const loaded: string[] = [];
      const failed: string[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const url = urls[index]!;
        if (results[index]!.status === "fulfilled") loaded.push(url);
        else failed.push(url);
      }
      postResult({ type: "preload-complete", loaded, failed });
    })
    .catch((error) => {
      console.warn("[construction] material worker preload failed", error);
      postResult({ type: "preload-complete", loaded: [], failed: urls });
    });
};
