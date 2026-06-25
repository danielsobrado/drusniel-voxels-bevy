import * as THREE from "three";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "../environment/environment.js";
import { createSkyNodeMaterial, type SkyNodeHandle } from "../gpu/sky_node_material.js";
import type { AppSky } from "./app_sky.js";

export class WebGpuSkyEnvironment implements AppSky {
  private readonly scene: THREE.Scene;
  private readonly renderer: { toneMappingExposure: number };
  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.Material>;
  private readonly previousBackground: THREE.Scene["background"];
  private readonly background = new THREE.Color();
  private readonly settings: EnvironmentSettings;
  private readonly colors = {
    sun: DEFAULT_ENVIRONMENT_COLORS.sun.clone(),
    zenith: DEFAULT_ENVIRONMENT_COLORS.zenith.clone(),
    horizon: DEFAULT_ENVIRONMENT_COLORS.horizon.clone(),
    ground: DEFAULT_ENVIRONMENT_COLORS.ground.clone(),
    skyLight: DEFAULT_ENVIRONMENT_COLORS.skyLight.clone(),
    groundLight: DEFAULT_ENVIRONMENT_COLORS.groundLight.clone(),
  };
  private readonly handle: SkyNodeHandle;
  private disposed = false;

  constructor(options: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer | { toneMappingExposure: number };
    radius: number;
    settings: EnvironmentSettings;
  }) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.settings = { ...options.settings };
    this.previousBackground = this.scene.background;
    this.handle = createSkyNodeMaterial(this.settings, this.colors);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(options.radius, 48, 24), this.handle.material);
    this.mesh.name = "webgpu-sky-environment";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.scene.add(this.mesh);
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.updateBackground();
  }

  lighting(): EnvironmentLighting {
    const lighting = this.handle.lighting;
    return {
      sunDirection: lighting.sunDirection.clone(),
      sunColor: lighting.sunColor.clone(),
      skyLight: lighting.skyLight.clone(),
      groundLight: lighting.groundLight.clone(),
    };
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  updateCamera(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  updateSettings(settings: Partial<EnvironmentSettings>): void {
    Object.assign(this.settings, settings);
    this.handle.updateSettings(this.settings);
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.updateBackground();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.scene.background === this.background) this.scene.background = this.previousBackground;
  }

  private updateBackground(): void {
    this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity);
    this.scene.background = this.background;
  }
}
