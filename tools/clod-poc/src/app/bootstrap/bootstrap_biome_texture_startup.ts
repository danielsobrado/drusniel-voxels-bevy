import * as THREE from "three";
import { createBakedMacroTintTexture } from "../../gpu/terrain_node_baked_macro_tint.js";
import { createProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import {
  createBiomeTextureStreamingManager,
  type BiomeTextureStreamingManager,
} from "../../textures/biome_texture_streaming_manager.js";
import type { parseProceduralTextureConfig } from "../../textures/materialRecipes.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { WorldSource } from "../../world_source/world_source.js";
import type { FloatingOriginController } from "../../precision/floating_origin.js";
import type { createTerrainMaterialController } from "../../terrain/material/terrain_material_controller.js";

const MAX_TERRAIN_TEXTURE_WINDOW_CACHE = 8;

export interface BootstrapBiomeTextureWorldCell {
  proceduralTerrain: ReturnType<typeof createProceduralTerrainTextures> | null;
  proceduralTextureConfig: ReturnType<typeof parseProceduralTextureConfig>;
  bakedMacroTint: THREE.DataTexture | null;
  worldSource: WorldSource;
}

export interface BootstrapBiomeTextureStartupInput {
  world: BootstrapBiomeTextureWorldCell;
  terrainMaterialSource: string;
  floatingOrigin: FloatingOriginController;
  camera: THREE.PerspectiveCamera;
  materialController: ReturnType<typeof createTerrainMaterialController>;
  applyTerrainTextures: () => void;
  longViewHooks: ClodHooks | null;
}

export interface BootstrapBiomeTextureStartupResult {
  biomeTextureStreaming: BiomeTextureStreamingManager | null;
}

export function runBootstrapBiomeTextureStartup(
  input: BootstrapBiomeTextureStartupInput,
): BootstrapBiomeTextureStartupResult {
  const {
    world,
    terrainMaterialSource,
    floatingOrigin,
    camera,
    materialController,
    applyTerrainTextures,
    longViewHooks,
  } = input;

  let terrainTextureWindowSwaps = 0;
  const terrainTextureWindowCache = new Map<string, {
    config: typeof world.proceduralTextureConfig;
    terrain: NonNullable<typeof world.proceduralTerrain>;
    macroTint: typeof world.bakedMacroTint;
  }>();
  const biomeTextureStreaming = world.proceduralTerrain
    ? createBiomeTextureStreamingManager({
        baseConfig: world.proceduralTextureConfig,
        sampleBiome: (x, z) => world.worldSource.sampleBiome(x, z),
        deferWindowSwaps: true,
        onActiveWindowChanged: (nextConfig, activeBiomeMaterials) => {
          const signature = activeBiomeMaterials.join("|");
          let cached = terrainTextureWindowCache.get(signature);
          if (!cached) {
            const nextTerrain = createProceduralTerrainTextures(nextConfig);
            const bakeRes = Math.min(512, nextTerrain.noise.resolution);
            const nextMacroTint = createBakedMacroTintTexture(
              nextTerrain.noise.noiseA,
              nextTerrain.noise.noiseB,
              bakeRes,
            );
            cached = { config: nextConfig, terrain: nextTerrain, macroTint: nextMacroTint };
            terrainTextureWindowCache.set(signature, cached);
            while (terrainTextureWindowCache.size > MAX_TERRAIN_TEXTURE_WINDOW_CACHE) {
              const firstKey = terrainTextureWindowCache.keys().next().value as string | undefined;
              if (!firstKey) break;
              terrainTextureWindowCache.delete(firstKey);
            }
          }
          world.proceduralTextureConfig = cached.config;
          world.proceduralTerrain = cached.terrain;
          world.bakedMacroTint = cached.macroTint;
          terrainTextureWindowSwaps++;
          materialController.setProceduralTerrain(cached.terrain, cached.config, cached.macroTint);
          applyTerrainTextures();
          if (longViewHooks?.stats) {
            longViewHooks.stats.counters.terrainTextureWindowSwaps = terrainTextureWindowSwaps;
            longViewHooks.stats.counters.terrainTextureActiveBiomes = activeBiomeMaterials.length;
            longViewHooks.stats.counters.terrainTextureWindowCacheSize = terrainTextureWindowCache.size;
          }
        },
      })
    : null;

  if (terrainMaterialSource === "procedural") {
    const initialWorldCamera = floatingOrigin.getWorldCamera(camera);
    biomeTextureStreaming?.update({ x: initialWorldCamera.position.x, z: initialWorldCamera.position.z, frameIndex: 0 });
  }

  return { biomeTextureStreaming };
}
