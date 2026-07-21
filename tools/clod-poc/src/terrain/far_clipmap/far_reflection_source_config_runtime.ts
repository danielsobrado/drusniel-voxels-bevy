import type { FarReflectionSourceConfig } from "./far_reflection_source.js";

let activeConfig: FarReflectionSourceConfig | null = null;
let activeOwner = 0;
let nextOwner = 1;

export function configureFarReflectionSource(config: FarReflectionSourceConfig | null): () => void {
  const owner = nextOwner++;
  activeOwner = owner;
  activeConfig = config ? { ...config } : null;
  return () => {
    if (activeOwner !== owner) return;
    activeOwner = 0;
    activeConfig = null;
  };
}

export function readConfiguredFarReflectionSource(): FarReflectionSourceConfig | null {
  return activeConfig ? { ...activeConfig } : null;
}
