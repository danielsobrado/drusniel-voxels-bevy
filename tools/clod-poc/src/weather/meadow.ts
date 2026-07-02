import * as THREE from "three";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";
import type { MeadowWeatherSettings, MeadowWeatherStats, MeadowWeatherOptions } from "./meadow_types.js";
import { DEFAULT_MEADOW_WEATHER_SETTINGS, MEADOW_CELL_SIZE, MEADOW_PARTICLE_COUNT } from "./meadow_defaults.js";
import { createMeadowGeometry, createMeadowNodeMaterial, createMeadowShaderMaterial } from "./meadow_material.js";

export type { MeadowWeatherSettings, MeadowWeatherStats, MeadowWeatherOptions } from "./meadow_types.js";
export { DEFAULT_MEADOW_WEATHER_SETTINGS, MEADOW_CELL_SIZE, MEADOW_PARTICLE_COUNT } from "./meadow_defaults.js";

export class MeadowWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly meadowMaterial: RainWeatherShaderHandle;
  private readonly meadowMesh: THREE.Mesh;
  private readonly anchor = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private settings = { ...DEFAULT_MEADOW_WEATHER_SETTINGS };

  constructor(options: MeadowWeatherOptions) {
    this.group.name = "weather-meadow";
    this.group.visible = this.settings.enabled;
    const geometry = createMeadowGeometry(options.seed ?? 0x6d3a8f21);
    this.meadowMaterial = options.isWebGpu ? createMeadowNodeMaterial() : createMeadowShaderMaterial();
    this.meadowMesh = new THREE.Mesh(geometry, this.meadowMaterial.material);
    this.meadowMesh.name = "weather-meadow-pollen";
    this.meadowMesh.frustumCulled = true;
    this.meadowMesh.renderOrder = 43;
    this.group.add(this.meadowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: MeadowWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
      windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    this.meadowMaterial.setIntensity(this.settings.intensity);
    this.meadowMaterial.setWind(this.settings.windX, this.settings.windZ);
  }

  update(deltaSeconds: number, elapsedSeconds: number, focus: THREE.Vector3): void {
    void deltaSeconds;
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
  }

  getStats(): MeadowWeatherStats {
    return { particles: this.group.visible ? MEADOW_PARTICLE_COUNT : 0 };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.meadowMesh.geometry.dispose();
    this.meadowMaterial.dispose();
  }
}
