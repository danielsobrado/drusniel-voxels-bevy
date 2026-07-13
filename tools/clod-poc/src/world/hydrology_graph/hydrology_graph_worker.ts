import { collectHydrologyGraphTransferables } from "./hydrology_graph_artifact.js";
import { buildHydrologyGraphWorkerRequest } from "./hydrology_graph_worker_build.js";
import type { HydrologyGraphWorkerRequest, HydrologyGraphWorkerResponse } from "./hydrology_graph_worker_protocol.js";

const ctx = self as unknown as {
  postMessage(message: HydrologyGraphWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<HydrologyGraphWorkerRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const request = event.data;
  void buildHydrologyGraphWorkerRequest(request, (progress) => {
    ctx.postMessage({ type: "hydrologyGraphProgress", requestId: request.requestId, ...progress });
  }).then((artifact) => {
    ctx.postMessage(
      { type: "hydrologyGraphBuilt", requestId: request.requestId, artifact },
      collectHydrologyGraphTransferables(artifact.graph),
    );
  }).catch((error) => {
    ctx.postMessage({
      type: "hydrologyGraphError",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

