import * as THREE from "three";

export interface EnvironmentSettings {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  skyIntensity: number;
  groundIntensity: number;
  exposure: number;
  horizonSoftness: number;
  sunDiskIntensity: number;
  sunGlowIntensity: number;
  hazeIntensity: number;
}

export interface EnvironmentColors {
  sun: THREE.Color;
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface EnvironmentLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface SkyEnvironmentOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  radius: number;
  settings: EnvironmentSettings;
  colors: EnvironmentColors;
}

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  sunAzimuthDeg: 128,
  sunElevationDeg: 55,
  sunIntensity: 1.0,
  skyIntensity: 1.0,
  groundIntensity: 1.0,
  exposure: 1.05,
  horizonSoftness: 0.72,
  sunDiskIntensity: 1.0,
  sunGlowIntensity: 1.0,
  hazeIntensity: 0.22,
};

export const DEFAULT_ENVIRONMENT_COLORS: EnvironmentColors = {
  sun: new THREE.Color(0.95, 0.86, 0.68),
  zenith: new THREE.Color(0x476d9f),
  horizon: new THREE.Color(0xbfc9d2),
  ground: new THREE.Color(0x383328),
  skyLight: new THREE.Color(0x6b7a94),
  groundLight: new THREE.Color(0x2e2921),
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uSkyIntensity;
  uniform float uGroundIntensity;
  uniform float uHorizonSoftness;
  uniform float uSunDiskIntensity;
  uniform float uSunGlowIntensity;
  uniform float uHazeIntensity;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    float skyGradient = pow(up, max(uHorizonSoftness, 0.01));
    vec3 upperSky = mix(uHorizon, uZenith, skyGradient) * uSkyIntensity;
    float groundBlend = smoothstep(-0.18, 0.03, dir.y);
    vec3 sky = mix(uGround * uGroundIntensity, upperSky, groundBlend);

    float haze = exp(-abs(dir.y) * 12.0) * uHazeIntensity;
    sky = mix(sky, uHorizon * uSkyIntensity, clamp(haze, 0.0, 1.0));

    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float aboveHorizon = smoothstep(-0.02, 0.02, dir.y);
    float sunDisk = smoothstep(0.9995, 0.9999, sunDot) * uSunDiskIntensity;
    float sunGlow = pow(sunDot, 18.0) * 0.18 * uSunGlowIntensity;
    sky += uSunColor * (sunDisk + sunGlow) * aboveHorizon;

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function sunDirectionFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    Math.cos(azimuth) * horizontal,
    Math.sin(elevation),
    Math.sin(azimuth) * horizontal,
  ).normalize();
}

export class SkyEnvironment {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly previousBackground: THREE.Scene["background"];
  private readonly background = new THREE.Color();
  private readonly settings: EnvironmentSettings;
  private readonly colors: EnvironmentColors;
  private disposed = false;

  constructor(options: SkyEnvironmentOptions) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.settings = { ...options.settings };
    this.colors = {
      sun: options.colors.sun.clone(),
      zenith: options.colors.zenith.clone(),
      horizon: options.colors.horizon.clone(),
      ground: options.colors.ground.clone(),
      skyLight: options.colors.skyLight.clone(),
      groundLight: options.colors.groundLight.clone(),
    };
    this.previousBackground = this.scene.background;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uZenith: { value: this.colors.zenith.clone() },
        uHorizon: { value: this.colors.horizon.clone() },
        uGround: { value: this.colors.ground.clone() },
        uSunColor: { value: this.colors.sun.clone() },
        uSkyIntensity: { value: this.settings.skyIntensity },
        uGroundIntensity: { value: this.settings.groundIntensity },
        uHorizonSoftness: { value: this.settings.horizonSoftness },
        uSunDiskIntensity: { value: this.settings.sunDiskIntensity },
        uSunGlowIntensity: { value: this.settings.sunGlowIntensity },
        uHazeIntensity: { value: this.settings.hazeIntensity },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(options.radius, 48, 24), material);
    this.mesh.name = "sky-environment";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.scene.add(this.mesh);

    this.updateColors(this.colors);
    this.updateSettings(this.settings);
  }

  updateSettings(settings: Partial<EnvironmentSettings>): void {
    Object.assign(this.settings, settings);
    const uniforms = this.mesh.material.uniforms;
    uniforms.uSunDir.value.copy(
      sunDirectionFromAngles(this.settings.sunAzimuthDeg, this.settings.sunElevationDeg),
    );
    uniforms.uSunColor.value.copy(this.colors.sun).multiplyScalar(this.settings.sunIntensity);
    uniforms.uSkyIntensity.value = this.settings.skyIntensity;
    uniforms.uGroundIntensity.value = this.settings.groundIntensity;
    uniforms.uHorizonSoftness.value = this.settings.horizonSoftness;
    uniforms.uSunDiskIntensity.value = this.settings.sunDiskIntensity;
    uniforms.uSunGlowIntensity.value = this.settings.sunGlowIntensity;
    uniforms.uHazeIntensity.value = this.settings.hazeIntensity;
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity);
    this.scene.background = this.background;
  }

  updateColors(colors: Partial<EnvironmentColors>): void {
    if (colors.sun) this.colors.sun.copy(colors.sun);
    if (colors.zenith) this.colors.zenith.copy(colors.zenith);
    if (colors.horizon) this.colors.horizon.copy(colors.horizon);
    if (colors.ground) this.colors.ground.copy(colors.ground);
    if (colors.skyLight) this.colors.skyLight.copy(colors.skyLight);
    if (colors.groundLight) this.colors.groundLight.copy(colors.groundLight);

    const uniforms = this.mesh.material.uniforms;
    uniforms.uSunColor.value.copy(this.colors.sun).multiplyScalar(this.settings.sunIntensity);
    uniforms.uZenith.value.copy(this.colors.zenith);
    uniforms.uHorizon.value.copy(this.colors.horizon);
    uniforms.uGround.value.copy(this.colors.ground);
    this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity);
    this.scene.background = this.background;
  }

  updateCamera(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  lighting(): EnvironmentLighting {
    return {
      sunDirection: sunDirectionFromAngles(this.settings.sunAzimuthDeg, this.settings.sunElevationDeg),
      sunColor: this.colors.sun.clone().multiplyScalar(this.settings.sunIntensity),
      skyLight: this.colors.skyLight.clone().multiplyScalar(this.settings.skyIntensity),
      groundLight: this.colors.groundLight.clone().multiplyScalar(this.settings.groundIntensity),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.scene.background === this.background) this.scene.background = this.previousBackground;
  }
}
