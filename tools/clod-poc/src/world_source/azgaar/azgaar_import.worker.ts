import {
  importAzgaarFullJson,
  type AzgaarFullJsonDocument,
  type AzgaarImportedWorld,
} from "./azgaar_json_importer.js";
import type { AzgaarImportConfig, AzgaarImportOptions } from "./azgaar_macro_world_source.js";

type ImportRequest = {
  id: number;
  document: AzgaarFullJsonDocument;
  config: AzgaarImportConfig;
  options?: AzgaarImportOptions;
};

type ImportResponse =
  | { id: number; world: AzgaarImportedWorld }
  | { id: number; error: string };

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<ImportRequest>) => void): void;
  postMessage(message: ImportResponse): void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  const { id, document, config, options } = event.data;
  try {
    workerScope.postMessage({ id, world: importAzgaarFullJson(document, config, options) });
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
