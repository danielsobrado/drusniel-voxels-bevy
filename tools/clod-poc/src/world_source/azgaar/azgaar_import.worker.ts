// @ts-nocheck
import { importAzgaarFullJson } from "./azgaar_json_importer.js";

self.addEventListener('message', (event) => {
  const {
    id,
    document,
    config,
    options,
  } = event.data ?? {};
  try {
    self.postMessage({ id, world: importAzgaarFullJson(document, config, options) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
