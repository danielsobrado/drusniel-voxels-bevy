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
import { placeCameraFacingBillboard } from "./weather_camera_billboard.js";
import { applyWindWeatherToMaterials, clampWindWeatherSettings, isWeatherVisible } from "./weather_settings.js";

const HAZE_DISTANCE = 1.2;
const HAZE_WIDTH_SCALE = 0.56;
const HAZE_HEIGHT_SCALE = 0.56;

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
    this.settings = clampWindWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyWindWeatherToMaterials(this.settings, [this.sandMaterial, this.hazeMaterial]);
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.center.copy(cameraPosition);
    this.sandMaterial.setCenter(this.center);
    this.sandMaterial.setTime(elapsedSeconds);
    this.hazeMaterial.setTime(elapsedSeconds);

    placeCameraFacingBillboard({
      camera: this.camera,
      mesh: this.hazeMesh,
      cameraPosition,
      distance: HAZE_DISTANCE,
      widthScale: HAZE_WIDTH_SCALE,
      heightScale: HAZE_HEIGHT_SCALE,
      scratchDirection: this.cameraDirection,
    });
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
