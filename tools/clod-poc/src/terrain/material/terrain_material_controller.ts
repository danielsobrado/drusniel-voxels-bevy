import * as THREE from "three";
import { hasPaintedTerrainEdits } from "../../terrain/terrain.js";
import type { TerrainColorAdjustments } from "../../material/material.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import {
  createWebGlTerrainMaterial,
  type TerrainMaterialHandle,
  type TerrainTextureApplyOptions,
} from "../../rendering/terrain_material.js";
import { createWebGpuTerrainMaterial } from "../../rendering/terrain_material_webgpu.js";
import type { ProceduralTerrainSlot, ProceduralTerrainTextures } from "../../textures/terrainTextureArrays.js";
import type { ProceduralTextureConfig } from "../../textures/materialRecipes.js";
import { LOD_COLORS } from "../../app/clod_constants.js";
import { PROCEDURAL_DEBUG_MODES, type ProceduralDebugMode } from "./terrain_material_constants.js";
import type { TerrainTextureController, TerrainTextureSlot } from "./terrain_texture_controller.js";
import {
  createTerrainMaterialDiagnosticSnapshot,
  installTerrainMaterialDiagnostics,
  type TerrainMaterialDiagnosticSnapshot,
} from "./terrain_material_diagnostics.js";

export interface TerrainMaterialUiState {
  terrainMaterialSource: "procedural" | "external_pbr" | "debug_flat";
  albedo: boolean;
  triplanar: boolean;
  normalMap: boolean;
  proceduralMicroNormals: boolean;
  normalIntensity: number;
  roughness: number;
  metalness: number;
  textureScale: number;
  textureBlendMode: string;
  textureBlendWidth: number;
  proceduralDebugMode: ProceduralDebugMode;
  colorByLod: boolean;
  wireframe: boolean;
  clodPerfMode: boolean;
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
  frontSideOnly: boolean;
  tintBubble: boolean;
}

export interface TerrainMaterialView {
  node: { level: number };
  mat: TerrainMaterialHandle;
  mesh?: THREE.Mesh;
  selected?: boolean;
}

export interface TerrainMaterialControllerDeps {
  isWebGpu: boolean;
  poolTerrainMaterial: boolean;
  worldCells: number;
  bakedMacroTint: THREE.DataTexture | null;
  proceduralTerrain: ProceduralTerrainTextures | null;
  proceduralTextureConfig: ProceduralTextureConfig;
  textureController: TerrainTextureController;
  getMaterialState: () => TerrainMaterialUiState;
  getColorAdjustments: () => TerrainColorAdjustments;
  getLighting: () => EnvironmentLighting;
  getViews: () => Iterable<TerrainMaterialView>;
  onTexturesApplied: () => void;
  onColorByLodChanged: (enabled: boolean) => void;
  getColorByLodUserOverride: () => boolean;
  setColorByLodUserOverride: (value: boolean) => void;
  getColorByLodController: () => { updateDisplay: () => void } | null;
}

export interface TerrainMaterialController {
  readonly materials: Set<TerrainMaterialHandle>;
  makeTerrainMaterial(color: number): TerrainMaterialHandle;
  forEachMaterial(fn: (mat: TerrainMaterialHandle) => void): void;
  applyLighting(mat: TerrainMaterialHandle, lighting?: EnvironmentLighting): void;
  applyColorAdjustments(): void;
  activeTerrainSlots(): readonly (TerrainTextureSlot | ProceduralTerrainSlot)[];
  availableTerrainSlots(): readonly (TerrainTextureSlot | ProceduralTerrainSlot)[];
  texturesActive(): boolean;
  terrainTextureUniformOptions(): TerrainTextureApplyOptions;
  applyTerrainTextures(): void;
  setProceduralTerrain(
    terrain: ProceduralTerrainTextures | null,
    config: ProceduralTextureConfig,
    macroTint?: THREE.DataTexture | null,
  ): void;
  setRiverTerrainWetnessMask(mask: THREE.Texture | null): void;
  applyColorByLodToMaterials(on: boolean): void;
  syncColorByLod(): void;
  configureChunkMaterial(mat: TerrainMaterialHandle): void;
  diagnostics(): TerrainMaterialDiagnosticSnapshot;
  readonly sharedMaterial: TerrainMaterialHandle | null;
}

export function createTerrainMaterialController(deps: TerrainMaterialControllerDeps): TerrainMaterialController {
  const terrainMaterials = new Set<TerrainMaterialHandle>();
  let sharedTerrainMaterial: TerrainMaterialHandle | null = null;
  let lastTexturesActive: boolean | null = null;
  let riverTerrainWetnessMask: THREE.Texture | null = null;
  let proceduralTerrain = deps.proceduralTerrain;
  let proceduralTextureConfig = deps.proceduralTextureConfig;
  let bakedMacroTint = deps.bakedMacroTint;

  const makeTerrainMaterial = (color: number): TerrainMaterialHandle => {
    if (deps.poolTerrainMaterial) {
      sharedTerrainMaterial ??= createWebGpuTerrainMaterial(0xb9c0c8);
      terrainMaterials.add(sharedTerrainMaterial);
      return sharedTerrainMaterial;
    }
    const handle = deps.isWebGpu ? createWebGpuTerrainMaterial(color) : createWebGlTerrainMaterial(color);
    terrainMaterials.add(handle);
    return handle;
  };

  const activeTerrainSlots = (): readonly (TerrainTextureSlot | ProceduralTerrainSlot)[] => {
    const state = deps.getMaterialState();
    if (state.terrainMaterialSource === "procedural" && proceduralTerrain) return proceduralTerrain.slots;
    if (state.terrainMaterialSource === "debug_flat") return [];
    return deps.textureController.slots;
  };

  const availableTerrainSlots = (): readonly (TerrainTextureSlot | ProceduralTerrainSlot)[] => {
    const active = activeTerrainSlots();
    if (active.length > 0) return active;
    if (deps.textureController.hasAnyLoadedTexture()) return deps.textureController.slots;
    return proceduralTerrain?.slots ?? deps.textureController.slots;
  };

  const texturesActive = () => {
    const state = deps.getMaterialState();
    return state.albedo && (
      (state.terrainMaterialSource === "procedural" && proceduralTerrain !== null)
      || (state.terrainMaterialSource === "external_pbr" && deps.textureController.hasAnyLoadedTexture())
    );
  };

  const terrainTextureUniformOptions = (): TerrainTextureApplyOptions => {
    const state = deps.getMaterialState();
    const proceduralActive = state.terrainMaterialSource === "procedural" && proceduralTerrain !== null;
    if (!proceduralActive) deps.textureController.ensureTextureArrays(state.terrainMaterialSource);
    const painted = hasPaintedTerrainEdits();
    const masks = proceduralTextureConfig.terrain.masks;
    const materials = proceduralTextureConfig.terrain.materials;
    return {
      enabled: texturesActive(),
      triplanar: state.triplanar,
      normalMap: proceduralActive ? state.proceduralMicroNormals : state.normalMap,
      normalIntensity: state.normalIntensity,
      roughness: state.roughness,
      metalness: state.metalness,
      textureScale: state.textureScale,
      blendBands: state.textureBlendMode === "blend bands",
      blendWidth: state.textureBlendWidth,
      painted,
      albedoArray: proceduralActive ? proceduralTerrain!.albedoArray : deps.textureController.getAlbedoArray(),
      normalArray: proceduralActive ? proceduralTerrain!.normalArray : deps.textureController.getNormalArray(),
      procedural: proceduralActive ? {
        enabled: true,
        noiseA: proceduralTerrain!.noise.noiseA,
        noiseB: proceduralTerrain!.noise.noiseB,
        debugMode: PROCEDURAL_DEBUG_MODES[state.proceduralDebugMode],
        microFadeStart: proceduralTextureConfig.terrain.micro_normal.fade_start_m,
        microFadeEnd: proceduralTextureConfig.terrain.micro_normal.fade_end_m,
        lodBias: state.colorByLod ? 40 : 0,
        scales: [
          proceduralTextureConfig.terrain.macro_variation_m[1],
          proceduralTextureConfig.terrain.meso_variation_m[1],
          masks.page_lod_normal_fade_m,
          masks.wet_roughness,
        ],
        snowMask: [masks.snow_height[0], masks.snow_height[1], masks.snow_upness[0], masks.snow_upness[1]],
        wetMask: [masks.wet_height[0], masks.wet_height[1], masks.wet_upness[0], masks.wet_upness[1]],
        slopeMasks: [masks.moss_upness[0], masks.moss_upness[1], masks.gravel_slope[0], masks.gravel_slope[1]],
        tintStrengths: [masks.snow_tint_strength, masks.moss_tint_strength, masks.gravel_tint_strength, masks.wet_tint_strength],
        materialRoughness: [
          materials.grass.roughness,
          materials.rock.roughness,
          materials.sand.roughness,
          materials.dirt.roughness,
        ],
        mossTint: masks.moss_tint,
        gravelTint: masks.gravel_tint,
        wetTint: masks.wet_tint,
        snowTint: masks.snow_tint,
        normalMapMask: proceduralTerrain!.normalMapMask,
      } : {
        enabled: false,
        noiseA: null,
        noiseB: null,
        debugMode: PROCEDURAL_DEBUG_MODES[state.proceduralDebugMode],
        microFadeStart: 45,
        microFadeEnd: 85,
        lodBias: 0,
      },
      bakedMacroTint: bakedMacroTint ?? undefined,
      riverWetnessMask: riverTerrainWetnessMask ?? undefined,
      worldSize: deps.worldCells,
      biomeSplat: proceduralActive,
    };
  };

  const applyTerrainTextures = () => {
    const slots = activeTerrainSlots();
    const options = terrainTextureUniformOptions();
    for (const material of terrainMaterials) material.setTextures(slots, options);
    deps.onTexturesApplied();
    syncColorByLod();
  };

  const setProceduralTerrain = (
    terrain: ProceduralTerrainTextures | null,
    config: ProceduralTextureConfig,
    macroTint?: THREE.DataTexture | null,
  ): void => {
    proceduralTerrain = terrain;
    proceduralTextureConfig = config;
    if (macroTint !== undefined) {
      bakedMacroTint?.dispose();
      bakedMacroTint = macroTint;
    }
  };

  const setRiverTerrainWetnessMask = (mask: THREE.Texture | null): void => {
    if (riverTerrainWetnessMask === mask) return;
    riverTerrainWetnessMask?.dispose();
    riverTerrainWetnessMask = mask;
    applyTerrainTextures();
  };

  const applyColorByLodToMaterials = (on: boolean) => {
    if (deps.poolTerrainMaterial) return;
    for (const view of deps.getViews()) {
      view.mat.setBaseColor(on ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8);
    }
  };

  const syncColorByLod = () => {
    const state = deps.getMaterialState();
    const active = texturesActive();
    if (lastTexturesActive !== null && active !== lastTexturesActive) {
      deps.setColorByLodUserOverride(false);
    }
    lastTexturesActive = active;
    if (!deps.getColorByLodUserOverride()) {
      state.colorByLod = state.clodPerfMode;
      deps.getColorByLodController()?.updateDisplay();
    }
    applyColorByLodToMaterials(state.colorByLod);
  };

  const configureChunkMaterial = (mat: TerrainMaterialHandle) => {
    if (deps.poolTerrainMaterial) return;
    const state = deps.getMaterialState();
    mat.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    mat.setWireframe(state.wireframe);
    mat.setTriplanar(state.triplanar);
    mat.setColorAdjust(deps.getColorAdjustments());
    mat.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
    mat.setTextures(activeTerrainSlots(), terrainTextureUniformOptions());
    mat.setLighting(deps.getLighting());
  };

  const diagnostics = (): TerrainMaterialDiagnosticSnapshot => createTerrainMaterialDiagnosticSnapshot({
    backend: deps.isWebGpu ? "webgpu" : "webgl",
    worldCells: deps.worldCells,
    url: typeof location === "undefined" ? "http://localhost/" : location.href,
    state: deps.getMaterialState(),
    slots: activeTerrainSlots(),
    options: terrainTextureUniformOptions(),
    views: deps.getViews(),
    texturesActive: texturesActive(),
  });
  installTerrainMaterialDiagnostics(diagnostics);

  return {
    materials: terrainMaterials,
    makeTerrainMaterial,
    forEachMaterial: (fn) => {
      for (const material of terrainMaterials) fn(material);
    },
    applyLighting: (mat, lighting = deps.getLighting()) => {
      mat.setLighting(lighting);
    },
    applyColorAdjustments: () => {
      const adjustments = deps.getColorAdjustments();
      for (const material of terrainMaterials) material.setColorAdjust(adjustments);
    },
    activeTerrainSlots,
    availableTerrainSlots,
    texturesActive,
    terrainTextureUniformOptions,
    applyTerrainTextures,
    setProceduralTerrain,
    setRiverTerrainWetnessMask,
    applyColorByLodToMaterials,
    syncColorByLod,
    configureChunkMaterial,
    diagnostics,
    get sharedMaterial() { return sharedTerrainMaterial; },
  };
}
