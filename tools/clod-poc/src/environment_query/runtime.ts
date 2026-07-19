import type { HydrologySystem } from "../water/hydrologySystem.js";
import { getDigEditRevision } from "../terrain/terrain.js";
import type { EnvironmentBatchSampler } from "./batch.js";
import { HydrologyEnvironmentQuery } from "./hydrology_adapter.js";
import { SunVisibilityEnvironmentQuery } from "./sun_visibility_adapter.js";
import { TerrainEnvironmentQuery } from "./terrain_adapter.js";
import { createLiveTerrainEnvironmentAuthority } from "./terrain_authority.js";
import type { EnvironmentQuery } from "./types.js";
import type { EnvironmentQueryDiagnostics } from "./diagnostics.js";

export type ComposedEnvironmentQuery = EnvironmentQuery & EnvironmentBatchSampler;

export interface EnvironmentQueryRuntime {
  readonly query: ComposedEnvironmentQuery;
  readonly diagnostics: EnvironmentQueryDiagnostics;
  dispose(): void;
}

let activeQuery: ComposedEnvironmentQuery | null = null;

export function createEnvironmentQueryRuntime(hydrologySystem: HydrologySystem): EnvironmentQueryRuntime {
  const hydrology = new HydrologyEnvironmentQuery({
    hydrology: {
      sample: (x, z, hintM) => hydrologySystem.sample(x, z, hintM),
      revision: getDigEditRevision,
    },
  });
  const terrain = new TerrainEnvironmentQuery({
    base: hydrology,
    terrain: createLiveTerrainEnvironmentAuthority(),
  });
  const query = new SunVisibilityEnvironmentQuery({ base: terrain });
  activeQuery = query;

  return {
    query,
    diagnostics: hydrology.diagnostics,
    dispose() {
      if (activeQuery === query) activeQuery = null;
      terrain.clearSampleCache();
      hydrology.clearSampleCache();
    },
  };
}

export function readActiveEnvironmentQuery(): ComposedEnvironmentQuery | null {
  return activeQuery;
}

export function bindActiveEnvironmentQuery(query: ComposedEnvironmentQuery | null): void {
  activeQuery = query;
}
