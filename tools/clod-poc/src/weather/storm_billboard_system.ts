import * as THREE from "three";
import { createStormNodeMaterial } from "./rainNodeMaterial.js";
import { createStormShaderMaterial, type RainWeatherShaderHandle } from "./rainShaderMaterial.js";
import { DEFAULT_STORM_WEATHER_SETTINGS } from "./rain_defaults.js";
import type { StormWeatherOptions, StormWeatherSettings, StormWeatherStats } from "./rain_types.js";
import { placeCameraFacingBillboard } from "./weather_camera_billboard.js";

const LIGHTNING_DISTANCE = 1.5;

export class StormLightningSystem {
  private readonly group = new THREE.Group();
  private readonly stormMaterial: RainWeatherShaderHandle;
  private readonly stormMesh: THREE.Mesh;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly center = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private settings = { ...DEFAULT_STORM_WEATHER_SETTINGS };

  constructor(options: StormWeatherOptions) {
    this.camera = options.camera;
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;

    this.stormMaterial = options.isWebGpu ? createStormNodeMaterial() : createStormShaderMaterial();
    this.stormMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), this.stormMaterial.material);
    this.stormMesh.name = "weather-storm-lightning";
    this.stormMesh.frustumCulled = false;
    this.stormMesh.renderOrder = 99;

    this.group.add(this.stormMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: StormWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    this.stormMaterial.setIntensity(this.settings.intensity);
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.center.copy(cameraPosition);
    this.stormMaterial.setTime(elapsedSeconds);
    placeCameraFacingBillboard({
      camera: this.camera,
      mesh: this.stormMesh,
      cameraPosition,
      distance: LIGHTNING_DISTANCE,
      scratchDirection: this.cameraDirection,
    });
  }

  getStats(): StormWeatherStats {
    return { active: this.group.visible };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.stormMesh.geometry.dispose();
    this.stormMaterial.dispose();
  }
}
