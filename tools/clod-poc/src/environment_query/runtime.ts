import type { HydrologySystem } from "../water/hydrologySystem.js";
import { getDigEditRevision } from "../terrain/terrain.js";
import type { EnvironmentBatchSampler } from "./batch.js";
import {
  HydrologyEnvironmentQuery,
  type HydrologyEnvironmentAuthority,
} from "./hydrology_adapter.js";
import {
  SunVisibilityEnvironmentQuery,
  type SunVisibilityEnvironmentAuthority,
} from "./sun_visibility_adapter.js";
import {
  TerrainEnvironmentQuery,
  type TerrainEnvironmentAuthority,
} from "./terrain_adapter.js";
import { createLiveTerrainEnvironmentAuthority } from "./terrain_authority.js";
import type { EnvironmentQuery } from "./types.js";
import type { EnvironmentQueryDiagnostics } from "./diagnostics.js";

export type ComposedEnvironmentQuery = EnvironmentQuery & EnvironmentBatchSampler;

export interface EnvironmentQueryRuntime {
  readonly query: ComposedEnvironmentQuery;
  readonly diagnostics: EnvironmentQueryDiagnostics;
  dispose(): void;
}

export interface EnvironmentQueryAuthoritySet {
  readonly hydrology: HydrologyEnvironmentAuthority;
  readonly terrain: TerrainEnvironmentAuthority;
  readonly visibility?: SunVisibilityEnvironmentAuthority;
}

let activeQuery: ComposedEnvironmentQuery | null = null;

export function createEnvironmentQueryRuntime(hydrologySystem: HydrologySystem): EnvironmentQueryRuntime {
  return createEnvironmentQueryRuntimeFromAuthorities({
    hydrology: {
      sample: (x, z, hintM) => hydrologySystem.sample(x, z, hintM),
      revision: getDigEditRevision,
    },
    terrain: createLiveTerrainEnvironmentAuthority(),
  });
}

export function createEnvironmentQueryRuntimeFromAuthorities(
  authorities: EnvironmentQueryAuthoritySet,
): EnvironmentQueryRuntime {
  const hydrology = new HydrologyEnvironmentQuery({ hydrology: authorities.hydrology });
  const terrain = new TerrainEnvironmentQuery({
    base: hydrology,
    terrain: authorities.terrain,
  });
  const query = new SunVisibilityEnvironmentQuery({
    base: terrain,
    ...(authorities.visibility ? { visibility: authorities.visibility } : {}),
  });
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
