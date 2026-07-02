import * as THREE from "three";
import type { StormWeatherSettings, StormWeatherStats } from "./rain.js";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";
import { DEFAULT_SEED, REPOSITION_DISTANCE, STRIKE_COUNT } from "./storm_ground_constants.js";
import { createImpactGeometry, createStrikeGeometry, markStrikeAttributesDirty } from "./storm_ground_geometry.js";
import {
  createStormGroundImpactNodeMaterial,
  createStormGroundImpactShaderMaterial,
  createStormGroundNodeMaterial,
  createStormGroundShaderMaterial,
} from "./storm_ground_materials.js";
import { StormGroundStrikePlacement } from "./storm_ground_placement.js";
import type { StormLightningOptions, StrikeBuffers } from "./storm_ground_types.js";
import { applyStormWeatherToMaterials, clampStormWeatherSettings, isWeatherVisible } from "./weather_settings.js";

export type { StormLightningOptions } from "./storm_ground_types.js";

export class StormLightningSystem {
  private readonly group = new THREE.Group();
  private readonly strikeMaterial: RainWeatherShaderHandle;
  private readonly impactMaterial: RainWeatherShaderHandle;
  private readonly strikeMesh: THREE.Mesh;
  private readonly impactMesh: THREE.Mesh;
  private readonly buffers: StrikeBuffers;
  private readonly placement: StormGroundStrikePlacement;
  private readonly placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private settings = { enabled: false, intensity: 1 };

  constructor(options: StormLightningOptions) {
    this.placement = new StormGroundStrikePlacement(options.samplers, options.worldCells, options.seed ?? DEFAULT_SEED);
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;

    this.strikeMaterial = options.isWebGpu ? createStormGroundNodeMaterial() : createStormGroundShaderMaterial();
    this.impactMaterial = options.isWebGpu ? createStormGroundImpactNodeMaterial() : createStormGroundImpactShaderMaterial();
    const strikes = createStrikeGeometry(STRIKE_COUNT);
    this.buffers = strikes.buffers;
    this.strikeMesh = new THREE.Mesh(strikes.geometry, this.strikeMaterial.material);
    this.strikeMesh.name = "weather-storm-ground-lightning";
    this.strikeMesh.frustumCulled = false;
    this.strikeMesh.renderOrder = 96;

    this.impactMesh = new THREE.Mesh(createImpactGeometry(this.buffers), this.impactMaterial.material);
    this.impactMesh.name = "weather-storm-impact-roots";
    this.impactMesh.frustumCulled = false;
    this.impactMesh.renderOrder = 97;

    this.group.add(this.impactMesh, this.strikeMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: StormWeatherSettings): void {
    this.settings = clampStormWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyStormWeatherToMaterials(this.settings, [this.strikeMaterial, this.impactMaterial]);
  }

  update(deltaSeconds: number, elapsedSeconds: number, focus: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.strikeMaterial.setTime(elapsedSeconds);
    this.impactMaterial.setTime(elapsedSeconds);
    if (
      !Number.isFinite(this.placementCenter.x) ||
      this.placementCenter.distanceToSquared(focus) > REPOSITION_DISTANCE * REPOSITION_DISTANCE
    ) {
      this.placementCenter.copy(focus);
      this.placement.reposition(this.buffers, focus);
      markStrikeAttributesDirty([this.strikeMesh.geometry, this.impactMesh.geometry]);
    }
  }

  getStats(): StormWeatherStats {
    return { active: this.group.visible };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.strikeMesh.geometry.dispose();
    this.impactMesh.geometry.dispose();
    this.strikeMaterial.dispose();
    this.impactMaterial.dispose();
  }
}
