import * as THREE from "three";
import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";
import type {
  MeadowWeatherEnvironment,
  MeadowWeatherMaterialHandle,
  MeadowWeatherOptions,
  MeadowWeatherSettings,
  MeadowWeatherStats,
} from "./meadow_types.js";
import {
  DEFAULT_MEADOW_WEATHER_SETTINGS,
  MEADOW_CELL_SIZE,
  MEADOW_PARTICLE_COUNT,
} from "./meadow_defaults.js";
import { createMeadowGeometry, createMeadowNodeMaterial, createMeadowShaderMaterial } from "./meadow_material.js";

export type { MeadowWeatherSettings, MeadowWeatherStats, MeadowWeatherOptions } from "./meadow_types.js";
export { DEFAULT_MEADOW_WEATHER_SETTINGS, MEADOW_CELL_SIZE, MEADOW_PARTICLE_COUNT } from "./meadow_defaults.js";

export class MeadowWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly meadowMaterial: MeadowWeatherMaterialHandle;
  private readonly meadowMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  private readonly anchor = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private settings = cloneSettings(DEFAULT_MEADOW_WEATHER_SETTINGS);
  private visualAmount = 0;
  private atlasValid = false;
  private atlasVersion = -1;
  private frame = 0;

  constructor(options: MeadowWeatherOptions) {
    this.group.name = "weather-meadow";
    const geometry = createMeadowGeometry(options.seed ?? 0x6d3a8f21);
    this.meadowMaterial = options.isWebGpu ? createMeadowNodeMaterial() : createMeadowShaderMaterial();
    this.meadowMesh = new THREE.Mesh(geometry, this.meadowMaterial.material);
    this.meadowMesh.name = "weather-sunbeam-motes";
    this.meadowMesh.frustumCulled = true;
    this.meadowMesh.renderOrder = 43;
    this.group.add(this.meadowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: MeadowWeatherSettings): void {
    this.settings = cloneSettings(settings);
    this.meadowMesh.geometry.instanceCount = Math.min(
      MEADOW_PARTICLE_COUNT,
      Math.max(0, Math.floor(this.settings.motes.maxParticles)),
    );
    this.meadowMaterial.setIntensity(THREE.MathUtils.clamp(this.settings.intensity, 0, 1.6));
    this.meadowMaterial.setWind(
      THREE.MathUtils.clamp(this.settings.windX, -5, 5),
      THREE.MathUtils.clamp(this.settings.windZ, -5, 5),
    );
    this.meadowMaterial.setMoteSettings(this.settings.motes);
    this.applyVisibility();
  }

  update(
    deltaSeconds: number,
    elapsedSeconds: number,
    focus: THREE.Vector3,
    environment: MeadowWeatherEnvironment,
  ): void {
    void deltaSeconds;
    this.visualAmount = THREE.MathUtils.clamp(environment.amount, 0, 1);
    this.applyVisibility();
    if (!this.group.visible) return;

    const nextX = Math.floor(focus.x / MEADOW_CELL_SIZE) * MEADOW_CELL_SIZE + MEADOW_CELL_SIZE * 0.5;
    const nextZ = Math.floor(focus.z / MEADOW_CELL_SIZE) * MEADOW_CELL_SIZE + MEADOW_CELL_SIZE * 0.5;
    if (!Number.isFinite(this.anchor.x) || Math.abs(nextX - this.anchor.x) > 0.001 || Math.abs(nextZ - this.anchor.z) > 0.001) {
      this.anchor.set(nextX, focus.y, nextZ);
      this.group.position.copy(this.anchor);
      this.meadowMaterial.setCenter(this.anchor);
    } else if (Math.abs(focus.y - this.anchor.y) > 0.25) {
      this.anchor.y = focus.y;
      this.group.position.y = focus.y;
      this.meadowMaterial.setCenter(this.anchor);
    }

    this.meadowMaterial.setTime(elapsedSeconds);
    this.meadowMaterial.setEnvironment(environment);
    this.syncSunVisibilityAtlas();
    this.frame += 1;
  }

  getStats(): MeadowWeatherStats {
    const activeParticles = this.group.visible
      ? Math.floor(this.meadowMesh.geometry.instanceCount * this.settings.motes.density)
      : 0;
    return {
      particles: activeParticles,
      atlasValid: this.atlasValid,
      visualAmount: this.visualAmount,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.meadowMesh.geometry.dispose();
    this.meadowMaterial.dispose();
  }

  private applyVisibility(): void {
    const motes = this.settings.motes;
    this.group.visible = this.settings.enabled
      && motes.enabled
      && this.settings.intensity > 0.001
      && motes.strength > 0.001
      && motes.maxParticles > 0
      && motes.density > 0.001
      && this.visualAmount > 0.001;
  }

  private syncSunVisibilityAtlas(): void {
    const atlas = getSunLightGpuAtlas();
    const updatePeriod = Math.max(1, this.settings.motes.updatePeriodFrames);
    if (atlas.version === this.atlasVersion && this.frame % updatePeriod !== 0) return;
    this.atlasVersion = atlas.version;
    this.atlasValid = atlas.valid > 0;
    this.meadowMaterial.setSunVisibilityAtlas(
      atlas.originX,
      atlas.originZ,
      atlas.worldSize,
      atlas.valid,
    );
  }
}

function cloneSettings(settings: MeadowWeatherSettings): MeadowWeatherSettings {
  return {
    enabled: settings.enabled,
    intensity: settings.intensity,
    windX: settings.windX,
    windZ: settings.windZ,
    motes: {
      ...settings.motes,
      warmColorRgb: [...settings.motes.warmColorRgb],
      coldColorRgb: [...settings.motes.coldColorRgb],
    },
  };
}
