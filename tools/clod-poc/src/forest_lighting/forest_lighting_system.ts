import * as THREE from "three";
import {
  cloneForestLightingSettings,
  type ForestLightingSettings,
} from "./forest_lighting_config.js";
import {
  clearForestLightingField,
  createForestLightingField,
  finalizeForestLightingField,
  splatCanopyInfluence,
  splatUnderstoryInfluence,
  type ForestLightingField,
  type ForestLightingTreeProxy,
  type ForestLightingUnderstoryProxy,
} from "./forest_lighting_fields.js";
import {
  createForestLightingTexture,
  type ForestLightingTextureHandle,
} from "./forest_lighting_texture.js";
import type { ForestLightingMaterialState } from "./forest_lighting_material.js";

export interface ForestLightingSystemOptions {
  worldCells: number;
  settings: ForestLightingSettings;
}

export interface ForestLightingUpdateInputs {
  treeProxies: readonly ForestLightingTreeProxy[];
  understoryProxies?: readonly ForestLightingUnderstoryProxy[];
  sunDirection: THREE.Vector3;
  force?: boolean;
}

export interface ForestLightingStats {
  enabled: boolean;
  resolution: number;
  treeProxies: number;
  understoryProxies: number;
  maxCanopy: number;
  maxAo: number;
  maxShadow: number;
  maxFog: number;
  updateMs: number;
  textureUpdates: number;
}

export class ForestLightingSystem {
  private readonly worldCells: number;
  private settings: ForestLightingSettings;
  private field: ForestLightingField;
  private textureHandle: ForestLightingTextureHandle;
  private readonly lastCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  private readonly lastSunDirection = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private stats: ForestLightingStats;
  private textureUpdates = 0;
  private disposed = false;
  private dirty = true;

  constructor(options: ForestLightingSystemOptions) {
    this.worldCells = options.worldCells;
    this.settings = cloneForestLightingSettings(options.settings);
    this.field = createForestLightingField(this.worldCells, this.settings);
    this.textureHandle = createForestLightingTexture(this.field);
    this.stats = this.emptyStats();
  }

  update(timeSeconds: number, center: THREE.Vector3, inputs: ForestLightingUpdateInputs): void {
    void timeSeconds;
    if (this.disposed) return;
    const treeProxies = inputs.treeProxies;
    const understoryProxies = inputs.understoryProxies ?? [];
    const shouldUpdate = inputs.force || this.dirty ||
      this.lastCenter.distanceTo(center) >= this.settings.field.updateDistanceM ||
      this.lastSunDirection.distanceTo(inputs.sunDirection) >= 0.025;
    if (!shouldUpdate) {
      this.stats.treeProxies = treeProxies.length;
      this.stats.understoryProxies = understoryProxies.length;
      return;
    }

    const start = performance.now();
    this.lastCenter.copy(center);
    this.lastSunDirection.copy(inputs.sunDirection);
    clearForestLightingField(this.field);
    if (this.settings.enabled) {
      for (const tree of treeProxies) splatCanopyInfluence(this.field, tree, this.settings);
      for (const understory of understoryProxies) splatUnderstoryInfluence(this.field, understory, this.settings);
      finalizeForestLightingField(this.field, inputs.sunDirection, this.settings);
    }
    this.textureHandle.update(this.field);
    this.textureUpdates++;
    this.dirty = false;
    this.stats = {
      enabled: this.settings.enabled,
      resolution: this.field.resolution,
      treeProxies: treeProxies.length,
      understoryProxies: understoryProxies.length,
      maxCanopy: maxOf(this.field.canopyDensity),
      maxAo: maxOf(this.field.ambientOcclusion),
      maxShadow: maxOf(this.field.shadowProxy),
      maxFog: maxOf(this.field.fogDensity),
      updateMs: performance.now() - start,
      textureUpdates: this.textureUpdates,
    };
  }

  updateSettings(settings: ForestLightingSettings): void {
    const next = cloneForestLightingSettings(settings);
    const resolutionChanged = next.field.resolution !== this.settings.field.resolution;
    this.settings = next;
    if (resolutionChanged) {
      this.textureHandle.dispose();
      this.field = createForestLightingField(this.worldCells, this.settings);
      this.textureHandle = createForestLightingTexture(this.field);
    }
    this.dirty = true;
    this.stats.enabled = this.settings.enabled;
    this.stats.resolution = this.settings.field.resolution;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.textureHandle.dispose();
  }

  getStats(): ForestLightingStats {
    return { ...this.stats };
  }

  getTextureHandle(): ForestLightingTextureHandle {
    return this.textureHandle;
  }

  getMaterialState(): ForestLightingMaterialState {
    return {
      textureHandle: this.textureHandle,
      settings: this.settings,
      worldCells: this.worldCells,
    };
  }

  private emptyStats(): ForestLightingStats {
    return {
      enabled: this.settings.enabled,
      resolution: this.settings.field.resolution,
      treeProxies: 0,
      understoryProxies: 0,
      maxCanopy: 0,
      maxAo: 0,
      maxShadow: 0,
      maxFog: 0,
      updateMs: 0,
      textureUpdates: this.textureUpdates,
    };
  }
}

function maxOf(values: Float32Array): number {
  let max = 0;
  for (const value of values) if (Number.isFinite(value) && value > max) max = value;
  return max;
}
