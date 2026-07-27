import type { AzgaarImportConfig } from "./azgaar_macro_world_source.js";
import {
  importAzgaarFullJson,
  isAzgaarFullJson,
  type AzgaarFullJsonDocument,
  type AzgaarImportedWorld,
} from "./azgaar_json_importer.js";
import { azgaarMacroToHeightmapSource } from "./azgaar_heightmap_adapter.js";
import type { HeightmapSource } from "../../terrain/heightmap_source.js";

/** Defaults tuned for clod-poc finite worlds (1 m cells, engine sea ≈ 18). */
export function defaultAzgaarImportConfig(overrides: Partial<{
  tileSize: number;
  atlasLongEdge: number;
  seaLevel: number;
  minHeight: number;
  maxHeight: number;
  oceanTransitionKilometers: number;
  verticalExaggeration: number;
  reliefExponent: number;
}> = {}): AzgaarImportConfig {
  return {
    map: { tileSize: overrides.tileSize ?? 1 },
    import: {
      azgaarAtlasLongEdge: overrides.atlasLongEdge ?? 1024,
      azgaarOceanTransitionKilometers: overrides.oceanTransitionKilometers ?? 50,
      azgaarVerticalExaggeration: overrides.verticalExaggeration ?? 1,
      azgaarReliefExponent: overrides.reliefExponent ?? 1,
    },
    terrain: {
      minHeight: overrides.minHeight ?? 0,
      maxHeight: overrides.maxHeight ?? 90,
    },
    world: {
      seaLevel: overrides.seaLevel ?? 18,
    },
  };
}

export interface LoadAzgaarMapOptions {
  worldCells: number;
  config?: AzgaarImportConfig;
  physicalWidthMeters?: number;
  heightmap?: {
    baseM?: number;
    spanM?: number;
    flipZ?: boolean;
    detailM?: number;
    seed?: number;
  };
}

export interface LoadedAzgaarMap {
  imported: AzgaarImportedWorld;
  heightmap: HeightmapSource;
}

export async function loadAzgaarFullJsonUrl(
  url: string,
  options: LoadAzgaarMapOptions,
): Promise<LoadedAzgaarMap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Azgaar map fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  const document = await response.json() as unknown;
  if (!isAzgaarFullJson(document)) {
    throw new Error(`URL is not an Azgaar Full JSON export: ${url}`);
  }
  return loadAzgaarFullJsonDocument(document, options);
}

export function loadAzgaarFullJsonDocument(
  document: AzgaarFullJsonDocument,
  options: LoadAzgaarMapOptions,
): LoadedAzgaarMap {
  const config = options.config ?? defaultAzgaarImportConfig();
  const imported = importAzgaarFullJson(document, config, {
    physicalWidthMeters: options.physicalWidthMeters,
  });
  const heightmap = azgaarMacroToHeightmapSource(imported.baseTerrain, {
    worldCells: options.worldCells,
    baseM: options.heightmap?.baseM,
    spanM: options.heightmap?.spanM,
    flipZ: options.heightmap?.flipZ,
    detailM: options.heightmap?.detailM ?? 1.2,
    seed: options.heightmap?.seed ?? 0,
  });
  return { imported, heightmap };
}
