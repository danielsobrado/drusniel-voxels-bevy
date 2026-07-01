import * as THREE from "three";
import { createSnowNodeMaterial } from "./rainNodeMaterial.js";
import { createSnowShaderMaterial, type RainWeatherShaderHandle } from "./rainShaderMaterial.js";
import { SNOW_FLAKE_COUNT } from "./rain_constants.js";
import { DEFAULT_SNOW_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createSnowGeometry } from "./rain_geometry.js";
import type { SnowWeatherOptions, SnowWeatherSettings, SnowWeatherStats } from "./rain_types.js";

export class SnowWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly snowMaterial: RainWeatherShaderHandle;
  private readonly snowMesh: THREE.Mesh;
  private readonly center = new THREE.Vector3();
  private settings = { ...DEFAULT_SNOW_WEATHER_SETTINGS };

  constructor(options: SnowWeatherOptions) {
    this.group.name = "weather-snow";
    this.group.visible = this.settings.enabled;

    this.snowMaterial = options.isWebGpu ? createSnowNodeMaterial() : createSnowShaderMaterial();
    this.snowMesh = new THREE.Mesh(createSnowGeometry(options.seed ?? 0x51eaf00d), this.snowMaterial.material);
    this.snowMesh.name = "weather-snow-flakes";
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 40;

    this.group.add(this.snowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: SnowWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
      windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    this.snowMaterial.setIntensity(this.settings.intensity);
    this.snowMaterial.setWind(this.settings.windX, this.settings.windZ);
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.center.copy(cameraPosition);
    this.snowMaterial.setCenter(this.center);
    this.snowMaterial.setTime(elapsedSeconds);
  }

  getStats(): SnowWeatherStats {
    return { flakes: this.group.visible ? SNOW_FLAKE_COUNT : 0 };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.snowMesh.geometry.dispose();
    this.snowMaterial.dispose();
  }
}
