import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import type { GrassSettings, GrassShaderMode } from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";
import {
  grassFootprintCenterX,
  grassFootprintCenterZ,
  grassFootprintRadius,
} from "./grass_patch_footprint.js";
import {
  grassShaderDefinition,
  populateGrassGeometry,
  type GrassGeometryBuilder,
} from "./grass_geometry.js";
import { grassThinnedInstanceCount, type GrassPatch } from "./grass_system_support.js";

export interface GrassPatchFactoryOptions {
  settings: GrassSettings;
  classicBladeGeometry: THREE.BufferGeometry;
  terrainPatchNearGeometry: THREE.BufferGeometry;
  terrainPatchNearCrossedGeometry: THREE.BufferGeometry;
  terrainPatchMidGeometry: THREE.BufferGeometry;
  terrainPatchFarGeometry: THREE.BufferGeometry;
  terrainPatchSuperGeometry: THREE.BufferGeometry;
  injectedGeometryBuilder: GrassGeometryBuilder | null;
  materialFor: (mode: GrassShaderMode) => THREE.Material;
}

export class GrassPatchFactory {
  private readonly settings: GrassSettings;
  private readonly classicBladeGeometry: THREE.BufferGeometry;
  private readonly terrainPatchNearGeometry: THREE.BufferGeometry;
  private readonly terrainPatchNearCrossedGeometry: THREE.BufferGeometry;
  private readonly terrainPatchMidGeometry: THREE.BufferGeometry;
  private readonly terrainPatchFarGeometry: THREE.BufferGeometry;
  private readonly terrainPatchSuperGeometry: THREE.BufferGeometry;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private readonly materialFor: (mode: GrassShaderMode) => THREE.Material;

  constructor(options: GrassPatchFactoryOptions) {
    this.settings = options.settings;
    this.classicBladeGeometry = options.classicBladeGeometry;
    this.terrainPatchNearGeometry = options.terrainPatchNearGeometry;
    this.terrainPatchNearCrossedGeometry = options.terrainPatchNearCrossedGeometry;
    this.terrainPatchMidGeometry = options.terrainPatchMidGeometry;
    this.terrainPatchFarGeometry = options.terrainPatchFarGeometry;
    this.terrainPatchSuperGeometry = options.terrainPatchSuperGeometry;
    this.injectedGeometryBuilder = options.injectedGeometryBuilder;
    this.materialFor = options.materialFor;
  }

  createPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const shader = grassShaderDefinition(this.settings.shaderMode);
    if (shader.patchStyle === "terrain-patch") {
      return this.createTerrainPatch(nodeId, footprint, instances);
    }
    const geometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, { mode: this.settings.shaderMode, tier: "near", settings: this.settings })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(geometry, this.classicBladeGeometry, footprint, instances, this.settings);
    }

    return {
      nodeId,
      meshes: [new THREE.Mesh(geometry, this.materialFor(this.settings.shaderMode))],
      centerX: grassFootprintCenterX(footprint),
      centerZ: grassFootprintCenterZ(footprint),
      radius: grassFootprintRadius(footprint),
      bladeCount: instances.length,
      midBladeCount: 0,
      visibleTier: "hidden",
    };
  }

  private createTerrainPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const nearBlade = this.settings.nearCrossedQuads
      ? this.terrainPatchNearCrossedGeometry
      : this.terrainPatchNearGeometry;
    const nearGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, {
          mode: this.settings.shaderMode,
          tier: "near",
          crossed: this.settings.nearCrossedQuads,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(nearGeometry, nearBlade, footprint, instances, this.settings);
    }

    const midThinRatio = this.settings.lod.midInstanceFraction;
    const farThinRatio = Number.isFinite(this.settings.lod.farInstanceFraction)
      ? this.settings.lod.farInstanceFraction
      : this.settings.lod.farDensityRatio;
    const midCount = grassThinnedInstanceCount(instances.length, midThinRatio);
    const midInstances = instances.slice(0, midCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.55,
      edgeFade: Math.min(1, instance.edgeFade * 1.15),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(midThinRatio),
    }));
    const midGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(midInstances, { mode: this.settings.shaderMode, tier: "mid", settings: this.settings })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(midGeometry, this.terrainPatchMidGeometry, footprint, midInstances, this.settings);
    }

    const farCount = grassThinnedInstanceCount(instances.length, farThinRatio);
    const farInstances = instances.slice(0, farCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.9,
      edgeFade: Math.min(1, instance.edgeFade * 1.25),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(farThinRatio),
    }));
    const farGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(farInstances, {
          mode: this.settings.shaderMode,
          tier: "far",
          crossed: true,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(farGeometry, this.terrainPatchFarGeometry, footprint, farInstances, this.settings);
    }

    const superThinRatio = farThinRatio <= 0 ? 0 : farThinRatio * 0.5;
    const superCount = grassThinnedInstanceCount(instances.length, superThinRatio);
    const superInstances = instances.slice(0, superCount).map((instance) => ({
      ...instance,
      height: instance.height * 2.35,
      edgeFade: Math.min(1, instance.edgeFade * 1.35),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(superThinRatio),
    }));
    const superGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(superInstances, {
          mode: this.settings.shaderMode,
          tier: "super",
          crossed: true,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(superGeometry, this.terrainPatchSuperGeometry, footprint, superInstances, this.settings);
    }

    const material = this.materialFor(this.settings.shaderMode);
    const nearMesh = new THREE.Mesh(nearGeometry, material);
    const midMesh = new THREE.Mesh(midGeometry, material);
    const farMesh = new THREE.Mesh(farGeometry, material);
    const superMesh = new THREE.Mesh(superGeometry, material);
    return {
      nodeId,
      meshes: [nearMesh, midMesh, farMesh, superMesh],
      centerX: grassFootprintCenterX(footprint),
      centerZ: grassFootprintCenterZ(footprint),
      radius: grassFootprintRadius(footprint),
      bladeCount: instances.length,
      midBladeCount: midInstances.length + farInstances.length + superInstances.length,
      visibleTier: "hidden",
    };
  }

  private widthCompensation(thinRatio: number): number {
    return THREE.MathUtils.clamp(
      1 / Math.sqrt(Math.max(thinRatio, 0.001)),
      1,
      this.settings.blade.maxWidthCompensation,
    );
  }
}
