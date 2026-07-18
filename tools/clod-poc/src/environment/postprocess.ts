import * as THREE from "three";
import {
  GOD_RAYS_SCREEN_SAMPLES,
  clampedRenderScale,
  withPostProcessDefaults,
  type PostProcessSettings,
  type PostProcessToneMapping,
} from "./postprocess_settings.js";
import { projectSunToScreen } from "../gpu/god_rays_screen.js";
import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";

export * from "./postprocess_settings.js";

const TAA_JITTER_SEQUENCE_LENGTH = 8;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const OUTPUT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tHistory;
  uniform sampler2D tHistoryDepth;
  uniform sampler2D tSunVisibilityAtlas;
  uniform vec2 uTexelSize;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform mat4 uInvCurrentViewProjection;
  uniform mat4 uPrevViewProjection;
  uniform float uHistoryReady;
  uniform float uFxaaEnabled;
  uniform float uFxaaEdgeThreshold;
  uniform float uFxaaSubpixelBlend;
  uniform float uTaaEnabled;
  uniform float uTaaHistoryWeight;
  uniform float uTaaDepthThreshold;
  uniform float uTaaSharpen;
  uniform float uTaaHistoryClampEnabled;
  uniform float uTaaHistoryClampStrength;
  uniform float uContactShadowsEnabled;
  uniform float uContactShadowsStrength;
  uniform float uContactShadowsRadiusPx;
  uniform float uContactShadowsDepthBias;
  uniform float uClarityEnabled;
  uniform float uClaritySharpen;
  uniform float uClarityDither;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uBloomEnabled;
  uniform float uBloomThreshold;
  uniform float uBloomStrength;
  uniform float uBloomRadius;
  uniform float uAerialPerspectiveEnabled;
  uniform float uAerialPerspectiveStart;
  uniform float uAerialPerspectiveEnd;
  uniform float uAerialPerspectiveStrength;
  uniform vec3 uAerialPerspectiveColor;
  uniform vec2 uSunVisibilityOrigin;
  uniform float uSunVisibilityWorldSize;
  uniform float uSunVisibilityValid;
  uniform vec2 uSunScreen;
  uniform float uSunScreenVisible;
  uniform float uGodRaysMode;
  uniform float uGodRaysDensity;
  uniform float uGodRaysDecay;
  uniform float uGodRaysWeight;
  uniform float uGodRaysExposure;
  varying vec2 vUv;

  #include <packing>

  float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  float interleavedNoise(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  vec3 reconstructWorld(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world = uInvCurrentViewProjection * ndc;
    world /= max(abs(world.w), 0.000001);
    return world.xyz;
  }

  float sunVisibilityAtWorld(vec3 worldPos) {
    if (uSunVisibilityValid < 0.5 || uSunVisibilityWorldSize <= 0.0) return 1.0;
    vec2 atlasUv = (worldPos.xz - uSunVisibilityOrigin) / uSunVisibilityWorldSize;
    float inside = step(0.0, atlasUv.x) * step(atlasUv.x, 1.0) * step(0.0, atlasUv.y) * step(atlasUv.y, 1.0);
    vec2 clampedUv = clamp(atlasUv, vec2(0.0), vec2(1.0));
    float sampleVisibility = texture2D(tSunVisibilityAtlas, clampedUv).r;
    return mix(1.0, sampleVisibility, inside);
  }

  float sunVisibilityAtDepthUv(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    if (depth >= 0.999999) return 1.0;
    return sunVisibilityAtWorld(reconstructWorld(uv, depth));
  }

  vec3 brightPass(vec2 uv) {
    vec3 sampleColor = texture2D(tDiffuse, uv).rgb;
    float brightness = max(max(sampleColor.r, sampleColor.g), sampleColor.b);
    float range = max(1.0 - uBloomThreshold, 0.0001);
    float mask = clamp((brightness - uBloomThreshold) / range, 0.0, 1.0);
    return sampleColor * mask;
  }

  vec3 bloomSample(vec2 offset, float weight) {
    vec2 spread = uTexelSize * max(uBloomRadius, 0.0) * 8.0;
    return brightPass(vUv + offset * spread) * weight;
  }

  vec3 bloomColor() {
    if (uBloomEnabled < 0.5 || uBloomStrength <= 0.0) return vec3(0.0);
    vec3 bloom = brightPass(vUv) * 0.18;
    bloom += bloomSample(vec2(1.0, 0.0), 0.10);
    bloom += bloomSample(vec2(-1.0, 0.0), 0.10);
    bloom += bloomSample(vec2(0.0, 1.0), 0.10);
    bloom += bloomSample(vec2(0.0, -1.0), 0.10);
    bloom += bloomSample(vec2(1.0, 1.0), 0.07);
    bloom += bloomSample(vec2(-1.0, 1.0), 0.07);
    bloom += bloomSample(vec2(1.0, -1.0), 0.07);
    bloom += bloomSample(vec2(-1.0, -1.0), 0.07);
    bloom += bloomSample(vec2(2.0, 0.0), 0.04);
    bloom += bloomSample(vec2(-2.0, 0.0), 0.04);
    bloom += bloomSample(vec2(0.0, 2.0), 0.04);
    bloom += bloomSample(vec2(0.0, -2.0), 0.04);
    return bloom;
  }

  vec3 fxaaSceneColor() {
    vec3 center = texture2D(tDiffuse, vUv).rgb;
    if (uFxaaEnabled < 0.5) return center;

    vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)).rgb;
    vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y)).rgb;
    vec3 east = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 west = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0)).rgb;

    float centerLuma = luminance(center);
    float minLuma = min(centerLuma, min(min(luminance(north), luminance(south)), min(luminance(east), luminance(west))));
    float maxLuma = max(centerLuma, max(max(luminance(north), luminance(south)), max(luminance(east), luminance(west))));
    float contrast = maxLuma - minLuma;
    if (contrast < clamp(uFxaaEdgeThreshold, 0.001, 1.0)) return center;

    vec3 cross = (north + south + west + east) * 0.25;
    return mix(center, cross, clamp(uFxaaSubpixelBlend, 0.0, 1.0));
  }

  vec3 sceneBlur() {
    vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)).rgb;
    vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y)).rgb;
    vec3 east = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 west = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0)).rgb;
    return (north + south + east + west) * 0.25;
  }

  vec3 historyClampColor(vec3 historyColor, vec3 currentColor) {
    if (uTaaHistoryClampEnabled < 0.5) return historyColor;
    vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)).rgb;
    vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y)).rgb;
    vec3 east = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)).rgb;
    vec3 west = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0)).rgb;
    vec3 minColor = min(currentColor, min(min(north, south), min(east, west)));
    vec3 maxColor = max(currentColor, max(max(north, south), max(east, west)));
    vec3 clampedHistory = clamp(historyColor, minColor, maxColor);
    return mix(historyColor, clampedHistory, clamp(uTaaHistoryClampStrength, 0.0, 1.0));
  }

  vec3 sharpenCurrent(vec3 color) {
    vec3 blur = sceneBlur();
    return max(color + (color - blur) * clamp(uTaaSharpen, 0.0, 1.0), vec3(0.0));
  }

  vec3 temporalSceneColor(vec3 currentColor) {
    if (uTaaEnabled < 0.5 || uHistoryReady < 0.5) return sharpenCurrent(currentColor);

    float depth = texture2D(tDepth, vUv).x;
    if (depth >= 0.999999) return currentColor;

    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world = uInvCurrentViewProjection * ndc;
    world /= max(abs(world.w), 0.000001);

    vec4 prevClip = uPrevViewProjection * world;
    if (prevClip.w <= 0.000001) return currentColor;

    vec3 prevNdc = prevClip.xyz / prevClip.w;
    vec2 prevUv = prevNdc.xy * 0.5 + 0.5;
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) return currentColor;

    float historyDepth = texture2D(tHistoryDepth, prevUv).x;
    float expectedHistoryDepth = prevNdc.z * 0.5 + 0.5;
    float depthDelta = abs(historyDepth - expectedHistoryDepth);
    if (historyDepth >= 0.999999 || depthDelta > uTaaDepthThreshold) return currentColor;

    vec3 historyColor = historyClampColor(texture2D(tHistory, prevUv).rgb, currentColor);
    float historyWeight = clamp(uTaaHistoryWeight, 0.0, 0.97);
    return sharpenCurrent(mix(currentColor, historyColor, historyWeight));
  }

  float contactShadowSample(float centerDepth, vec2 offset) {
    float sampleDepth = texture2D(tDepth, clamp(vUv + offset, vec2(0.0), vec2(1.0))).x;
    if (centerDepth >= 0.999999 || sampleDepth >= 0.999999) return 0.0;
    float closerDelta = centerDepth - sampleDepth;
    return smoothstep(uContactShadowsDepthBias, uContactShadowsDepthBias + 0.02, closerDelta);
  }

  float contactShadowFactor() {
    if (uContactShadowsEnabled < 0.5) return 1.0;
    float centerDepth = texture2D(tDepth, vUv).x;
    if (centerDepth >= 0.999999) return 1.0;
    vec2 radius = uTexelSize * max(uContactShadowsRadiusPx, 0.5);
    float occlusion = 0.0;
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0,  0.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0,  0.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 0.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 0.0, -1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0,  1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2( 1.0, -1.0));
    occlusion += contactShadowSample(centerDepth, radius * vec2(-1.0, -1.0));
    occlusion *= 0.125;
    return 1.0 - clamp(occlusion * uContactShadowsStrength, 0.0, 0.55);
  }

  vec3 aerialPerspective(vec3 color) {
    if (uAerialPerspectiveEnabled < 0.5 || uAerialPerspectiveStrength <= 0.0) return color;
    float depth = texture2D(tDepth, vUv).x;
    float geometryMask = 1.0 - step(0.999999, depth);
    float viewZ = perspectiveDepthToViewZ(depth, uCameraNear, uCameraFar);
    float distanceM = max(-viewZ, 0.0);
    float startM = min(uAerialPerspectiveStart, uAerialPerspectiveEnd - 0.001);
    float haze = smoothstep(startM, uAerialPerspectiveEnd, distanceM);
    float visibility = depth >= 0.999999 ? 1.0 : sunVisibilityAtWorld(reconstructWorld(vUv, depth));
    float litFog = mix(0.58, 1.08, visibility);
    vec3 fogColor = mix(uAerialPerspectiveColor * 0.72, uAerialPerspectiveColor, visibility);
    haze *= clamp(uAerialPerspectiveStrength, 0.0, 1.0) * geometryMask * litFog;
    return mix(color, fogColor, clamp(haze, 0.0, 1.0));
  }

  vec3 godRaysColor() {
    if (uGodRaysMode < 0.5 || uSunScreenVisible < 0.5 || uGodRaysExposure <= 0.0) return vec3(0.0);
    float sampleCount = uGodRaysMode < 1.5 ? ${GOD_RAYS_SCREEN_SAMPLES.cheap}.0 : ${GOD_RAYS_SCREEN_SAMPLES.heavy}.0;
    vec2 delta = (vUv - uSunScreen) * clamp(uGodRaysDensity, 0.0, 1.25) / sampleCount;
    vec2 coord = vUv;
    float decay = 1.0;
    float shafts = 0.0;
    for (int i = 0; i < ${GOD_RAYS_SCREEN_SAMPLES.heavy}; i++) {
      if (float(i) >= sampleCount) break;
      coord -= delta;
      if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) break;
      float depth = texture2D(tDepth, coord).x;
      float skyMask = step(0.999999, depth);
      float terrainVisibility = sunVisibilityAtDepthUv(coord);
      float sceneSource = luminance(texture2D(tDiffuse, coord).rgb);
      float source = skyMask * sceneSource + (1.0 - skyMask) * terrainVisibility * 0.12;
      shafts += source * decay * clamp(uGodRaysWeight, 0.0, 2.0);
      decay *= clamp(uGodRaysDecay, 0.1, 0.99);
    }
    float screenFalloff = 1.0 - smoothstep(0.0, 1.4, length(vUv - uSunScreen));
    float intensity = shafts * uGodRaysExposure * screenFalloff / sampleCount;
    return uAerialPerspectiveColor * max(intensity, 0.0);
  }

  vec3 clarityOutput(vec3 color) {
    if (uClarityEnabled < 0.5) return color;
    vec3 detail = color - sceneBlur();
    color = max(color + detail * clamp(uClaritySharpen, 0.0, 1.0), vec3(0.0));
    float dither = (interleavedNoise(gl_FragCoord.xy) - 0.5) * clamp(uClarityDither, 0.0, 0.05);
    return max(color + vec3(dither), vec3(0.0));
  }

  void main() {
    vec4 sampled = texture2D(tDiffuse, vUv);
    vec3 sourceColor = fxaaSceneColor();
    vec3 color = temporalSceneColor(sourceColor) * contactShadowFactor() * uExposure;
    color += bloomColor() * uBloomStrength;
    color = aerialPerspective(color);
    color += godRaysColor();
    color = (color - 0.5) * uContrast + 0.5;

    float luma = luminance(color);
    color = mix(vec3(luma), color, uSaturation);

    vec2 center = vUv - 0.5;
    float vignetteMask = smoothstep(0.2, 0.75, length(center));
    color *= 1.0 - uVignette * vignetteMask;
    color = clarityOutput(max(color, vec3(0.0)));

    gl_FragColor = vec4(color, sampled.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const POSTPROCESS_SHADER_TEST_HOOKS = {
  fullscreenVertex: FULLSCREEN_VERT,
  copyFragment: COPY_FRAG,
  outputFragment: OUTPUT_FRAG,
} as const;

function createFullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

function cameraClip(camera: THREE.Camera, key: "near" | "far", fallback: number): number {
  const value = (camera as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let current = index;
  while (current > 0) {
    result += fraction * (current % base);
    current = Math.floor(current / base);
    fraction /= base;
  }
  return result;
}

function setProjectionMatrixInverse(camera: THREE.Camera): void {
  const cameraWithInverse = camera as THREE.Camera & { projectionMatrixInverse?: THREE.Matrix4 };
  cameraWithInverse.projectionMatrixInverse?.copy(camera.projectionMatrix).invert();
}

function createSceneTarget(name: string): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.name = `${name}-depth`;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    depthTexture,
    stencilBuffer: false,
    samples: 0,
  });
  target.texture.name = `${name}-color`;
  return target;
}

function godRaysModeValue(mode: Required<PostProcessSettings>["godRaysMode"]): number {
  if (mode === "cheap") return 1;
  if (mode === "heavy" || mode === "volumetric") return 2;
  return 0;
}

function readSunDirection(): THREE.Vector3 | null {
  const value = (globalThis as unknown as { __drusnielSunLightSunDirection?: THREE.Vector3 }).__drusnielSunLightSunDirection;
  return value && typeof value.x === "number" && typeof value.y === "number" && typeof value.z === "number"
    ? value
    : null;
}

export function toneMappingModeToThree(mode: PostProcessToneMapping) {
  switch (mode) {
    case "agx":
      return THREE.AgXToneMapping;
    case "linear":
      return THREE.LinearToneMapping;
    case "none":
      return THREE.NoToneMapping;
    case "aces":
    default:
      return THREE.ACESFilmicToneMapping;
  }
}

export class PostProcessPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private target = createSceneTarget("clod-poc-postprocess-current");
  private historyTarget = createSceneTarget("clod-poc-postprocess-history");
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreenGeometry = createFullscreenTriangle();
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly outputMaterial: THREE.ShaderMaterial;
  private readonly fullscreenMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly cssSize = new THREE.Vector2(1, 1);
  private readonly renderTargetSize = new THREE.Vector2(1, 1);
  private readonly currentViewProjection = new THREE.Matrix4();
  private readonly inverseCurrentViewProjection = new THREE.Matrix4();
  private readonly previousViewProjection = new THREE.Matrix4();
  private readonly originalProjectionMatrix = new THREE.Matrix4();
  private readonly sunScreen = new THREE.Vector2(0.5, 0.5);
  private readonly sunDirection = new THREE.Vector3();
  private historyReady = false;
  private jitterFrame = 0;
  private settings: Required<PostProcessSettings>;

  constructor(renderer: THREE.WebGLRenderer, settings: PostProcessSettings) {
    this.renderer = renderer;
    this.settings = withPostProcessDefaults(settings);

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uOpacity: { value: this.settings.opacity },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: true,
    });

    const sunAtlas = getSunLightGpuAtlas();
    this.outputMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        tHistory: { value: this.historyTarget.texture },
        tHistoryDepth: { value: this.historyTarget.depthTexture },
        tSunVisibilityAtlas: { value: sunAtlas.texture },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 8000 },
        uInvCurrentViewProjection: { value: this.inverseCurrentViewProjection },
        uPrevViewProjection: { value: this.previousViewProjection },
        uHistoryReady: { value: 0 },
        uFxaaEnabled: { value: this.settings.fxaaEnabled ? 1 : 0 },
        uFxaaEdgeThreshold: { value: this.settings.fxaaEdgeThreshold },
        uFxaaSubpixelBlend: { value: this.settings.fxaaSubpixelBlend },
        uTaaEnabled: { value: this.settings.taaEnabled ? 1 : 0 },
        uTaaHistoryWeight: { value: this.settings.taaHistoryWeight },
        uTaaDepthThreshold: { value: this.settings.taaDepthThreshold },
        uTaaSharpen: { value: this.settings.taaSharpen },
        uTaaHistoryClampEnabled: { value: this.settings.taaHistoryClampEnabled ? 1 : 0 },
        uTaaHistoryClampStrength: { value: this.settings.taaHistoryClampStrength },
        uContactShadowsEnabled: { value: this.settings.contactShadowsEnabled ? 1 : 0 },
        uContactShadowsStrength: { value: this.settings.contactShadowsStrength },
        uContactShadowsRadiusPx: { value: this.settings.contactShadowsRadiusPx },
        uContactShadowsDepthBias: { value: this.settings.contactShadowsDepthBias },
        uClarityEnabled: { value: this.settings.clarityEnabled ? 1 : 0 },
        uClaritySharpen: { value: this.settings.claritySharpen },
        uClarityDither: { value: this.settings.clarityDither },
        uExposure: { value: this.settings.exposure },
        uContrast: { value: this.settings.contrast },
        uSaturation: { value: this.settings.saturation },
        uVignette: { value: this.settings.vignette },
        uBloomEnabled: { value: this.settings.bloomEnabled ? 1 : 0 },
        uBloomThreshold: { value: this.settings.bloomThreshold },
        uBloomStrength: { value: this.settings.bloomStrength },
        uBloomRadius: { value: this.settings.bloomRadius },
        uAerialPerspectiveEnabled: { value: this.settings.aerialPerspectiveEnabled ? 1 : 0 },
        uAerialPerspectiveStart: { value: this.settings.aerialPerspectiveStart },
        uAerialPerspectiveEnd: { value: this.settings.aerialPerspectiveEnd },
        uAerialPerspectiveStrength: { value: this.settings.aerialPerspectiveStrength },
        uAerialPerspectiveColor: { value: new THREE.Color(...this.settings.aerialPerspectiveColor) },
        uSunVisibilityOrigin: { value: new THREE.Vector2(sunAtlas.originX, sunAtlas.originZ) },
        uSunVisibilityWorldSize: { value: sunAtlas.worldSize },
        uSunVisibilityValid: { value: sunAtlas.valid },
        uSunScreen: { value: this.sunScreen },
        uSunScreenVisible: { value: 0 },
        uGodRaysMode: { value: godRaysModeValue(this.settings.godRaysMode) },
        uGodRaysDensity: { value: this.settings.godRaysDensity },
        uGodRaysDecay: { value: this.settings.godRaysDecay },
        uGodRaysWeight: { value: this.settings.godRaysWeight },
        uGodRaysExposure: { value: this.settings.godRaysExposure },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OUTPUT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    this.fullscreenMesh = new THREE.Mesh(this.fullscreenGeometry, this.outputMaterial);
    this.fullscreenMesh.frustumCulled = false;
    this.fullscreenScene.add(this.fullscreenMesh);
    this.updateSettings(this.settings);
  }

  setSize(width: number, height: number): void {
    this.cssSize.set(Math.max(1, width), Math.max(1, height));
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const pixelRatio = this.renderer.getPixelRatio();
    const fullWidth = this.drawingBufferSize.x || Math.floor(width * pixelRatio);
    const fullHeight = this.drawingBufferSize.y || Math.floor(height * pixelRatio);
    const renderScale = clampedRenderScale(this.settings.renderScale);
    const targetWidth = Math.max(1, Math.floor(fullWidth * renderScale));
    const targetHeight = Math.max(1, Math.floor(fullHeight * renderScale));
    this.renderTargetSize.set(targetWidth, targetHeight);
    this.target.setSize(targetWidth, targetHeight);
    this.historyTarget.setSize(targetWidth, targetHeight);
    this.historyReady = false;
    this.outputMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight);
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const previousRenderScale = this.settings?.renderScale ?? 1;
    const previousTaaEnabled = this.settings?.taaEnabled ?? false;
    const previousTaaJitterEnabled = this.settings?.taaJitterEnabled ?? false;
    const previousTaaHistoryClampEnabled = this.settings?.taaHistoryClampEnabled ?? false;
    this.settings = withPostProcessDefaults({ ...this.settings, ...settings });
    this.settings.renderScale = clampedRenderScale(this.settings.renderScale);
    if (previousRenderScale !== this.settings.renderScale) this.setSize(this.cssSize.x, this.cssSize.y);
    if (
      previousRenderScale !== this.settings.renderScale
      || previousTaaEnabled !== this.settings.taaEnabled
      || previousTaaJitterEnabled !== this.settings.taaJitterEnabled
      || previousTaaHistoryClampEnabled !== this.settings.taaHistoryClampEnabled
    ) {
      this.historyReady = false;
      this.jitterFrame = 0;
    }
    this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
    this.copyMaterial.uniforms.uOpacity.value = this.settings.opacity;
    this.outputMaterial.uniforms.uFxaaEnabled.value = this.settings.fxaaEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uFxaaEdgeThreshold.value = this.settings.fxaaEdgeThreshold;
    this.outputMaterial.uniforms.uFxaaSubpixelBlend.value = this.settings.fxaaSubpixelBlend;
    this.outputMaterial.uniforms.uTaaEnabled.value = this.settings.taaEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uTaaHistoryWeight.value = this.settings.taaHistoryWeight;
    this.outputMaterial.uniforms.uTaaDepthThreshold.value = this.settings.taaDepthThreshold;
    this.outputMaterial.uniforms.uTaaSharpen.value = this.settings.taaSharpen;
    this.outputMaterial.uniforms.uTaaHistoryClampEnabled.value = this.settings.taaHistoryClampEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uTaaHistoryClampStrength.value = this.settings.taaHistoryClampStrength;
    this.outputMaterial.uniforms.uContactShadowsEnabled.value = this.settings.contactShadowsEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uContactShadowsStrength.value = this.settings.contactShadowsStrength;
    this.outputMaterial.uniforms.uContactShadowsRadiusPx.value = this.settings.contactShadowsRadiusPx;
    this.outputMaterial.uniforms.uContactShadowsDepthBias.value = this.settings.contactShadowsDepthBias;
    this.outputMaterial.uniforms.uClarityEnabled.value = this.settings.clarityEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uClaritySharpen.value = this.settings.claritySharpen;
    this.outputMaterial.uniforms.uClarityDither.value = this.settings.clarityDither;
    this.outputMaterial.uniforms.uExposure.value = this.settings.exposure;
    this.outputMaterial.uniforms.uContrast.value = this.settings.contrast;
    this.outputMaterial.uniforms.uSaturation.value = this.settings.saturation;
    this.outputMaterial.uniforms.uVignette.value = this.settings.vignette;
    this.outputMaterial.uniforms.uBloomEnabled.value = this.settings.bloomEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uBloomThreshold.value = this.settings.bloomThreshold;
    this.outputMaterial.uniforms.uBloomStrength.value = this.settings.bloomStrength;
    this.outputMaterial.uniforms.uBloomRadius.value = this.settings.bloomRadius;
    this.outputMaterial.uniforms.uAerialPerspectiveEnabled.value = this.settings.aerialPerspectiveEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uAerialPerspectiveStart.value = this.settings.aerialPerspectiveStart;
    this.outputMaterial.uniforms.uAerialPerspectiveEnd.value = this.settings.aerialPerspectiveEnd;
    this.outputMaterial.uniforms.uAerialPerspectiveStrength.value = this.settings.aerialPerspectiveStrength;
    this.outputMaterial.uniforms.uAerialPerspectiveColor.value.setRGB(...this.settings.aerialPerspectiveColor);
    this.outputMaterial.uniforms.uGodRaysMode.value = godRaysModeValue(this.settings.godRaysMode);
    this.outputMaterial.uniforms.uGodRaysDensity.value = this.settings.godRaysDensity;
    this.outputMaterial.uniforms.uGodRaysDecay.value = this.settings.godRaysDecay;
    this.outputMaterial.uniforms.uGodRaysWeight.value = this.settings.godRaysWeight;
    this.outputMaterial.uniforms.uGodRaysExposure.value = this.settings.godRaysExposure;
  }

  private shouldJitterCamera(): boolean {
    return this.settings.enabled
      && this.settings.debugMode === "output"
      && this.settings.taaEnabled
      && this.settings.taaJitterEnabled
      && this.settings.taaJitterScale > 0;
  }

  private applyCameraJitter(camera: THREE.Camera): void {
    const width = Math.max(1, this.renderTargetSize.x || this.target.width);
    const height = Math.max(1, this.renderTargetSize.y || this.target.height);
    const sampleIndex = (this.jitterFrame % TAA_JITTER_SEQUENCE_LENGTH) + 1;
    const jitterX = (halton(sampleIndex, 2) - 0.5) * 2 * this.settings.taaJitterScale / width;
    const jitterY = (halton(sampleIndex, 3) - 0.5) * 2 * this.settings.taaJitterScale / height;
    this.jitterFrame += 1;
    this.originalProjectionMatrix.copy(camera.projectionMatrix);
    camera.projectionMatrix.elements[8] += jitterX;
    camera.projectionMatrix.elements[9] += jitterY;
    setProjectionMatrixInverse(camera);
  }

  private restoreCameraProjection(camera: THREE.Camera): void {
    camera.projectionMatrix.copy(this.originalProjectionMatrix);
    setProjectionMatrixInverse(camera);
  }

  private updateSunUniforms(camera: THREE.Camera): void {
    const atlas = getSunLightGpuAtlas();
    this.outputMaterial.uniforms.tSunVisibilityAtlas.value = atlas.texture;
    this.outputMaterial.uniforms.uSunVisibilityOrigin.value.set(atlas.originX, atlas.originZ);
    this.outputMaterial.uniforms.uSunVisibilityWorldSize.value = atlas.worldSize;
    this.outputMaterial.uniforms.uSunVisibilityValid.value = atlas.valid;

    const sunDir = readSunDirection();
    if (!sunDir || this.settings.godRaysMode === "off") {
      this.outputMaterial.uniforms.uSunScreenVisible.value = 0;
      return;
    }
    const sunInfo = projectSunToScreen(this.sunDirection.copy(sunDir).normalize(), camera);
    this.sunScreen.set(sunInfo.u, sunInfo.v);
    this.outputMaterial.uniforms.uSunScreen.value.copy(this.sunScreen);
    this.outputMaterial.uniforms.uSunScreenVisible.value = sunInfo.visible ? 1 : 0;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.historyReady = false;
      this.jitterFrame = 0;
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    camera.updateMatrixWorld();
    const shouldJitter = this.shouldJitterCamera();
    if (shouldJitter) this.applyCameraJitter(camera);

    this.currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inverseCurrentViewProjection.copy(this.currentViewProjection).invert();

    this.outputMaterial.uniforms.tDiffuse.value = this.target.texture;
    this.outputMaterial.uniforms.tDepth.value = this.target.depthTexture;
    this.outputMaterial.uniforms.tHistory.value = this.historyTarget.texture;
    this.outputMaterial.uniforms.tHistoryDepth.value = this.historyTarget.depthTexture;
    this.outputMaterial.uniforms.uHistoryReady.value = this.historyReady && this.settings.taaEnabled ? 1 : 0;
    this.outputMaterial.uniforms.uCameraNear.value = cameraClip(camera, "near", 0.1);
    this.outputMaterial.uniforms.uCameraFar.value = cameraClip(camera, "far", 8000);
    this.outputMaterial.uniforms.uInvCurrentViewProjection.value.copy(this.inverseCurrentViewProjection);
    this.outputMaterial.uniforms.uPrevViewProjection.value.copy(this.previousViewProjection);
    this.updateSunUniforms(camera);
    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture;

    this.renderer.setRenderTarget(this.target);
    try {
      this.renderer.render(scene, camera);
    } finally {
      if (shouldJitter) this.restoreCameraProjection(camera);
    }

    this.renderer.setRenderTarget(null);
    this.fullscreenMesh.material = this.settings.debugMode === "copy"
      ? this.copyMaterial
      : this.outputMaterial;
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);

    if (this.settings.taaEnabled) {
      this.previousViewProjection.copy(this.currentViewProjection);
      const renderedTarget = this.target;
      this.target = this.historyTarget;
      this.historyTarget = renderedTarget;
      this.historyReady = true;
    } else {
      this.previousViewProjection.copy(this.currentViewProjection);
      this.historyReady = false;
      this.jitterFrame = 0;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.historyTarget.dispose();
    this.fullscreenGeometry.dispose();
    this.copyMaterial.dispose();
    this.outputMaterial.dispose();
  }
}
