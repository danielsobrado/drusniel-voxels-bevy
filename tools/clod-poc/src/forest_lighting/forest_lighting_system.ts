import * as THREE from "three";
import {
  cloneForestLightingSettings,
  type ForestLightingSettings,
} from "./forest_lighting_config.js";
import {
  blurForestLightingCanopyRows,
  clearForestLightingField,
  createForestLightingField,
  createForestLightingFinalizeContext,
  finalizeForestLightingClampPass,
  finalizeForestLightingRows,
  splatCanopyInfluence,
  splatUnderstoryInfluence,
  type ForestLightingField,
  type ForestLightingFinalizeContext,
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

type ForestLightingBuildPhase = "splatTrees" | "splatUnderstory" | "blur" | "rows" | "clamp";

interface ForestLightingFieldBuild {
  center: THREE.Vector3;
  sunDirection: THREE.Vector3;
  treeProxies: readonly ForestLightingTreeProxy[];
  understoryProxies: readonly ForestLightingUnderstoryProxy[];
  phase: ForestLightingBuildPhase;
  cursor: number;
  finalize: ForestLightingFinalizeContext | null;
  buildMs: number;
}

/** Proxies splatted between deadline checks; also the minimum progress per step. */
const BUILD_SPLAT_CHECK_INTERVAL = 8;

export class ForestLightingSystem {
  private readonly worldCells: number;
  private settings: ForestLightingSettings;
  private field: ForestLightingField;
  /** Off-screen build target; swapped with `field` when a rebuild completes. */
  private buildField: ForestLightingField;
  private build: ForestLightingFieldBuild | null = null;
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
    this.buildField = createForestLightingField(this.worldCells, this.settings);
    this.textureHandle = createForestLightingTexture(this.field);
    this.stats = this.emptyStats();
  }

  shouldUpdate(center: THREE.Vector3, sunDirection: THREE.Vector3, force = false): boolean {
    if (this.disposed) return false;
    return force || this.dirty ||
      this.lastCenter.distanceTo(center) >= this.settings.field.updateDistanceM ||
      this.lastSunDirection.distanceTo(sunDirection) >= 0.025;
  }

  hasBuildInProgress(): boolean {
    return this.build !== null;
  }

  /** Start a rebuild into the off-screen field. The live field and texture stay
   *  untouched until {@link stepBuild} completes, so lighting never pops while a
   *  rebuild is amortized across frames. */
  beginBuild(center: THREE.Vector3, inputs: ForestLightingUpdateInputs): void {
    if (this.disposed) return;
    this.build = {
      center: center.clone(),
      sunDirection: inputs.sunDirection.clone(),
      treeProxies: inputs.treeProxies,
      understoryProxies: inputs.understoryProxies ?? [],
      phase: "splatTrees",
      cursor: 0,
      finalize: null,
      buildMs: 0,
    };
    clearForestLightingField(this.buildField);
  }

  /** Advance the in-progress rebuild until `deadlineMs`; at least one unit of
   *  progress is made per call. Returns true when the rebuild completed (field
   *  swapped, texture uploaded, stats refreshed) during this call. */
  stepBuild(deadlineMs: number): boolean {
    const build = this.build;
    if (!build || this.disposed) return false;
    const start = performance.now();
    if (!this.settings.enabled) {
      build.buildMs += performance.now() - start;
      this.completeBuild(build);
      return true;
    }

    let finished = false;
    stepping:
    for (;;) {
      switch (build.phase) {
        case "splatTrees": {
          let sinceCheck = 0;
          while (build.cursor < build.treeProxies.length) {
            splatCanopyInfluence(this.buildField, build.treeProxies[build.cursor], this.settings);
            build.cursor++;
            if (++sinceCheck >= BUILD_SPLAT_CHECK_INTERVAL) {
              sinceCheck = 0;
              if (performance.now() >= deadlineMs) break stepping;
            }
          }
          build.phase = "splatUnderstory";
          build.cursor = 0;
          break;
        }
        case "splatUnderstory": {
          let sinceCheck = 0;
          while (build.cursor < build.understoryProxies.length) {
            splatUnderstoryInfluence(this.buildField, build.understoryProxies[build.cursor], this.settings);
            build.cursor++;
            if (++sinceCheck >= BUILD_SPLAT_CHECK_INTERVAL) {
              sinceCheck = 0;
              if (performance.now() >= deadlineMs) break stepping;
            }
          }
          build.finalize = createForestLightingFinalizeContext(this.buildField, build.sunDirection, this.settings);
          build.phase = "blur";
          build.cursor = 0;
          break;
        }
        case "blur": {
          while (build.cursor < this.buildField.resolution) {
            blurForestLightingCanopyRows(this.buildField, build.finalize!, this.settings, build.cursor, build.cursor + 1);
            build.cursor++;
            if (performance.now() >= deadlineMs) break stepping;
          }
          build.phase = "rows";
          build.cursor = 0;
          break;
        }
        case "rows": {
          while (build.cursor < this.buildField.resolution) {
            finalizeForestLightingRows(this.buildField, build.finalize!, this.settings, build.cursor, build.cursor + 1);
            build.cursor++;
            if (performance.now() >= deadlineMs) break stepping;
          }
          build.phase = "clamp";
          break;
        }
        case "clamp": {
          finalizeForestLightingClampPass(this.buildField, build.finalize!, this.settings);
          finished = true;
          break stepping;
        }
      }
    }

    build.buildMs += performance.now() - start;
    if (finished) this.completeBuild(build);
    return finished;
  }

  private completeBuild(build: ForestLightingFieldBuild): void {
    this.textureHandle.update(this.buildField);
    this.textureUpdates++;
    const previousLive = this.field;
    this.field = this.buildField;
    this.buildField = previousLive;
    this.lastCenter.copy(build.center);
    this.lastSunDirection.copy(build.sunDirection);
    this.dirty = false;
    this.build = null;
    this.stats = {
      enabled: this.settings.enabled,
      resolution: this.field.resolution,
      treeProxies: build.treeProxies.length,
      understoryProxies: build.understoryProxies.length,
      maxCanopy: maxOf(this.field.canopyDensity),
      maxAo: maxOf(this.field.ambientOcclusion),
      maxShadow: maxOf(this.field.shadowProxy),
      maxFog: maxOf(this.field.fogDensity),
      updateMs: build.buildMs,
      textureUpdates: this.textureUpdates,
    };
  }

  update(timeSeconds: number, center: THREE.Vector3, inputs: ForestLightingUpdateInputs): void {
    void timeSeconds;
    if (this.disposed) return;
    const shouldUpdate = this.shouldUpdate(center, inputs.sunDirection, inputs.force);
    if (!shouldUpdate) {
      this.stats.treeProxies = inputs.treeProxies.length;
      this.stats.understoryProxies = (inputs.understoryProxies ?? []).length;
      return;
    }
    this.beginBuild(center, inputs);
    this.stepBuild(Number.POSITIVE_INFINITY);
  }

  updateSettings(settings: ForestLightingSettings): void {
    const next = cloneForestLightingSettings(settings);
    const resolutionChanged = next.field.resolution !== this.settings.field.resolution;
    this.settings = next;
    this.build = null;
    if (resolutionChanged) {
      this.textureHandle.dispose();
      this.field = createForestLightingField(this.worldCells, this.settings);
      this.buildField = createForestLightingField(this.worldCells, this.settings);
      this.textureHandle = createForestLightingTexture(this.field);
    }
    this.dirty = true;
    this.stats.enabled = this.settings.enabled;
    this.stats.resolution = this.settings.field.resolution;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.build = null;
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
