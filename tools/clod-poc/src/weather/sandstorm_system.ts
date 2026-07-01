import * as THREE from "three";
import { createSandstormHazeNodeMaterial, createSandstormNodeMaterial } from "./rainNodeMaterial.js";
import {
  createSandstormHazeShaderMaterial,
  createSandstormShaderMaterial,
  type RainWeatherShaderHandle,
} from "./rainShaderMaterial.js";
import { SANDSTORM_PARTICLE_COUNT } from "./rain_constants.js";
import { DEFAULT_SANDSTORM_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createSandstormGeometry } from "./rain_geometry.js";
import type { SandstormWeatherOptions, SandstormWeatherSettings, SandstormWeatherStats } from "./rain_types.js";

export class SandstormWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly sandMaterial: RainWeatherShaderHandle;
  private readonly hazeMaterial: RainWeatherShaderHandle;
  private readonly sandMesh: THREE.Mesh;
  private readonly hazeMesh: THREE.Mesh;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly center = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private settings = { ...DEFAULT_SANDSTORM_WEATHER_SETTINGS };

  constructor(options: SandstormWeatherOptions) {
    this.camera = options.camera;
    this.group.name = "weather-sandstorm";
    this.group.visible = this.settings.enabled;

    this.sandMaterial = options.isWebGpu ? createSandstormNodeMaterial() : createSandstormShaderMaterial();
    this.hazeMaterial = options.isWebGpu ? createSandstormHazeNodeMaterial() : createSandstormHazeShaderMaterial();
    this.sandMesh = new THREE.Mesh(createSandstormGeometry(options.seed ?? 0x5a4d570d), this.sandMaterial.material);
    this.sandMesh.name = "weather-sandstorm-puffs";
    this.sandMesh.frustumCulled = false;
    this.sandMesh.renderOrder = 43;

    this.hazeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3, 1, 1), this.hazeMaterial.material);
    this.hazeMesh.name = "weather-sandstorm-haze";
    this.hazeMesh.frustumCulled = false;
    this.hazeMesh.renderOrder = 98;

    this.group.add(this.sandMesh, this.hazeMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: SandstormWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
      windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    for (const material of [this.sandMaterial, this.hazeMaterial]) {
      material.setIntensity(this.settings.intensity);
      material.setWind(this.settings.windX, this.settings.windZ);
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.center.copy(cameraPosition);
    this.sandMaterial.setCenter(this.center);
    this.sandMaterial.setTime(elapsedSeconds);
    this.hazeMaterial.setTime(elapsedSeconds);

    this.camera.getWorldDirection(this.cameraDirection);
    this.hazeMesh.position.copy(cameraPosition).addScaledVector(this.cameraDirection, 1.2);
    this.hazeMesh.quaternion.copy(this.camera.quaternion);
    const height = 2 * 1.2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    this.hazeMesh.scale.set(height * this.camera.aspect * 0.56, height * 0.56, 1);
  }

  getStats(): SandstormWeatherStats {
    return { particles: this.group.visible ? SANDSTORM_PARTICLE_COUNT : 0, haze: this.group.visible };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sandMesh.geometry.dispose();
    this.hazeMesh.geometry.dispose();
    this.sandMaterial.dispose();
    this.hazeMaterial.dispose();
  }
}
