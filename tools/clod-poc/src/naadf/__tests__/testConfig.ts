import type { NaadfPocConfig } from "../config.js";
import { parseNaadfPocConfig } from "../config.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

export function createTestNaadfConfig(): NaadfPocConfig {
  const config = parseNaadfPocConfig(naadfYaml);
  return {
    ...config,
    nearPageTable: {
      ...config.nearPageTable,
      radiusChunksXz: 2,
    },
    streaming: {
      ...config.streaming,
      maxJobsPerFrame: 32,
      maxCommitsPerFrame: 32,
    },
    hashFallback: {
      ...config.hashFallback,
      capacity: 256,
    },
  };
}
