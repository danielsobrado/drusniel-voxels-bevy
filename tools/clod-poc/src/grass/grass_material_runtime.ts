import * as THREE from "three";
import {
  cloneLighting,
  createGrassMaterial,
  grassShaderDefinition,
  type GrassMaterialFactory,
  type GrassMaterialHandle,
} from "./grass_geometry.js";
import type { GrassLighting, GrassSettings, GrassShaderMode } from "./grass_config.js";
import type { GrassRingInstanceBuffers } from "./grass_gpu_ring.js";
import { grassFadeDistance } from "./grass_math.js";
import type { GrassPatch } from "./grass_system_support.js";

export interface GrassMaterialRuntimeOptions {
  settings: GrassSettings;
  lighting: GrassLighting;
  material?: GrassMaterialHandle;
  createMaterial?: GrassMaterialFactory;
}

export class GrassMaterialRuntime {
  private readonly materials = new Map<GrassShaderMode, THREE.ShaderMaterial>();
  private injectedMaterial: GrassMaterialHandle | null;
  private readonly injectedMaterialFactory: GrassMaterialFactory | null;
  private currentLighting: GrassLighting;

  constructor(options: GrassMaterialRuntimeOptions, modes: readonly GrassShaderMode[]) {
    this.currentLighting = cloneLighting(options.lighting);
    this.injectedMaterialFactory = options.createMaterial ?? null;
    this.injectedMaterial = options.material ?? null;
    if (this.injectedMaterialFactory) this.replaceInjectedMaterial(options.settings, []);
    if (!this.injectedMaterial) {
      for (const mode of modes) {
        this.materials.set(mode, createGrassMaterial(options.settings, options.lighting, mode));
      }
    }
  }

  updateTime(timeSeconds: number, center: THREE.Vector3): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.setTime?.(timeSeconds);
      this.injectedMaterial.setFadeCenter?.(center.x, center.z);
      return;
    }
    for (const material of this.materials.values()) {
      material.uniforms.uTime.value = timeSeconds;
    }
  }

  updateLighting(lighting: GrassLighting): void {
    this.currentLighting = cloneLighting(lighting);
    if (this.injectedMaterial) {
      this.injectedMaterial.updateLighting?.(lighting);
      return;
    }
    for (const material of this.materials.values()) {
      material.uniforms.uLight.value.copy(lighting.light);
      material.uniforms.uSunColor.value.copy(lighting.sunColor);
      material.uniforms.uSkyLight.value.copy(lighting.skyLight);
      material.uniforms.uGroundLight.value.copy(lighting.groundLight);
    }
  }

  updateSettings(settings: GrassSettings, ringMeshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.updateSettings?.(settings);
      this.syncGpuRingMaterialClones(ringMeshes);
      return;
    }
    for (const [mode, material] of this.materials) {
      material.uniforms.uBladeWidth.value = settings.bladeWidth;
      material.uniforms.uWindDirection.value.set(settings.wind.direction[0], settings.wind.direction[1]);
      material.uniforms.uWindStrength.value = settings.windStrength;
      material.uniforms.uWindSpeed.value = settings.windSpeed;
      material.uniforms.uNearDistance.value = settings.distance * settings.lod.nearFraction;
      material.uniforms.uMidDistance.value = settings.distance * settings.lod.midFraction;
      material.uniforms.uFadeDistance.value = grassFadeDistance(settings);
      const useAlphaToCoverage =
        grassShaderDefinition(mode).patchStyle === "terrain-patch" && settings.alphaToCoverage;
      material.alphaToCoverage = useAlphaToCoverage;
      material.uniforms.uAlphaToCoverage.value = useAlphaToCoverage ? 1 : 0;
    }
  }

  replaceInjectedMaterial(settings: GrassSettings, patches: readonly GrassPatch[]): void {
    if (!this.injectedMaterialFactory) return;
    const previous = this.injectedMaterial;
    this.injectedMaterial = this.injectedMaterialFactory(settings, this.currentLighting);
    for (const patch of patches) {
      for (const mesh of patch.meshes) mesh.material = this.injectedMaterial.material;
    }
    previous?.dispose?.();
  }

  rebuildInjectedRingMaterial(settings: GrassSettings, ringInstanceBuffers: GrassRingInstanceBuffers): void {
    if (!this.injectedMaterialFactory) return;
    const previous = this.injectedMaterial;
    this.injectedMaterial = this.injectedMaterialFactory(settings, this.currentLighting, ringInstanceBuffers);
    previous?.dispose?.();
  }

  materialFor(mode: GrassShaderMode): THREE.Material {
    if (this.injectedMaterial) return this.injectedMaterial.material;
    const material = this.materials.get(mode);
    if (!material) throw new Error(`Missing grass material for shader mode: ${mode}`);
    return material;
  }

  sharedMaterials(): Set<THREE.Material> {
    return new Set<THREE.Material>([
      ...this.materials.values(),
      ...(this.injectedMaterial ? [this.injectedMaterial.material] : []),
    ]);
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.injectedMaterial?.dispose?.();
  }

  get hasInjectedFactory(): boolean {
    return !!this.injectedMaterialFactory;
  }

  private syncGpuRingMaterialClones(ringMeshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]): void {
    if (!this.injectedMaterial) return;
    const source = this.injectedMaterial.material;
    for (const mesh of ringMeshes) {
      if (mesh.material === source) continue;
      mesh.material.alphaToCoverage = source.alphaToCoverage;
      mesh.material.needsUpdate = true;
    }
  }
}
