import { HalfFloatType, Matrix4, Vector3, type Camera, type Texture } from "three";
import { Storage3DTexture, type WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  Return,
  clamp,
  dot,
  exp,
  float,
  instanceIndex,
  mat4,
  smoothstep,
  texture,
  texture3D,
  textureStore,
  time,
  uniform,
  uvec3,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  type EnvironmentLighting,
} from "../environment/environment.js";
import { deriveEnvironmentLighting } from "../environment/lighting_model.js";
import type { PostFxAtmosphereSettings, PostFxFroxelSettings } from "./postfx_atmosphere.js";

type TslAny = any;
type ComputeNode = { setName?: (name: string) => void };
type MatrixUniformNode = TslAny & { value: Matrix4 };
type VectorUniformNode = TslAny & { value: Vector3 };

export const POSTFX_FROXEL_VOLUME_GRID = {
  width: 160,
  height: 90,
  depth: 64,
} as const;

export interface PostFxFroxelVolumeNodeInput {
  integratedTexture: Storage3DTexture;
  nearMeters: number;
  maxDistanceMeters: number;
}

export interface PostFxFroxelVolumeTerrainInput {
  heightTexture: Texture;
  canopyTexture?: Texture | null;
  hydrologyTexture?: Texture | null;
  cloudShadowTexture?: Texture | null;
  originX: number;
  originZ: number;
  extentMeters: number;
  hydrologyWorldSizeMeters?: number;
  cloudShadowWorldSizeMeters?: number;
  cloudShadowStrength?: number;
}

export interface PostFxFroxelVolumeOptions {
  terrain?: PostFxFroxelVolumeTerrainInput | null;
}

export interface ProjectedCanopySample {
  x: number;
  z: number;
  belowCanopy: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function postFxFroxelMoistureFactor(moisture: number): number {
  const m = clamp01(moisture);
  return 0.25 + 1.5 * m * m;
}

export function projectPostFxCanopySample(
  worldX: number,
  worldZ: number,
  worldY: number,
  groundY: number,
  sunDirection: Vector3,
  crownHeightMeters = 13,
): ProjectedCanopySample {
  const crownY = groundY + crownHeightMeters;
  const dy = crownY - worldY;
  const distance = Math.max(0, dy) / Math.max(0.08, sunDirection.y);
  return {
    x: worldX + sunDirection.x * distance,
    z: worldZ + sunDirection.z * distance,
    belowCanopy: dy > 0,
  };
}

function phaseHenyeyGreenstein(cosTheta: TslAny, g: number): TslAny {
  const gg = g * g;
  return float((1 - gg) / (4 * Math.PI)).div(float(1 + gg).sub(cosTheta.mul(2 * g)).pow(1.5));
}

function hashNoise2(uv: TslAny): TslAny {
  return dot(uv, vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
}

function hashNoise3(p: TslAny): TslAny {
  return dot(p, vec3(12.9898, 78.233, 37.719)).sin().mul(43758.5453).fract();
}

function densityAtHeight(heightMeters: TslAny, scaleHeightMeters: number): TslAny {
  return exp(heightMeters.max(0).div(-Math.max(0.0001, scaleHeightMeters)));
}

export class PostFxFroxelVolume {
  readonly scatterTexture: Storage3DTexture;
  readonly integratedTexture: Storage3DTexture;
  private readonly scatterKernel: TslAny;
  private readonly integrateKernel: TslAny;
  private readonly uCameraPosition = uniform(new Vector3()) as unknown as VectorUniformNode;
  private readonly uProjectionInverse = uniform(new Matrix4()) as unknown as MatrixUniformNode;
  private readonly uCameraWorld = uniform(new Matrix4()) as unknown as MatrixUniformNode;
  private readonly uSunDirection = uniform(new Vector3(0, 1, 0)) as unknown as VectorUniformNode;
  private readonly uSunRadiance = uniform(new Vector3(2.4, 2.3, 2.1)) as unknown as VectorUniformNode;
  private readonly uSkyRadiance = uniform(new Vector3(0.08, 0.09, 0.11)) as unknown as VectorUniformNode;
  private readonly projectionInverseScratch = new Matrix4();
  private readonly froxels: PostFxFroxelSettings;

  constructor(settings: PostFxAtmosphereSettings, options: PostFxFroxelVolumeOptions = {}) {
    this.froxels = settings.froxels;
    this.scatterTexture = this.createTexture();
    this.integratedTexture = this.createTexture();

    const { width, height, depth } = POSTFX_FROXEL_VOLUME_GRID;
    const maxDistanceMeters = Math.max(this.froxels.nearMeters, this.froxels.maxDistanceMeters);
    const nearMeters = Math.max(0.0001, this.froxels.nearMeters);
    const maxRatio = maxDistanceMeters / nearMeters;
    const froxels = this.froxels;
    const terrain = options.terrain ?? null;
    const terrainExtent = terrain ? Math.max(1, terrain.extentMeters) : 1;
    const terrainOrigin = terrain ? vec2(terrain.originX, terrain.originZ) : vec2(0, 0);
    const sampleTerrainUv = (xz: TslAny): TslAny => clamp(xz.sub(terrainOrigin).div(terrainExtent), 0, 1);
    const sampleTerrainHeight = (xz: TslAny): TslAny => terrain
      ? (texture(terrain.heightTexture, sampleTerrainUv(xz)) as TslAny).r
      : float(froxels.groundReferenceHeightMeters);
    const sampleCanopy = (xz: TslAny): TslAny => terrain?.canopyTexture
      ? (texture(terrain.canopyTexture, sampleTerrainUv(xz)) as TslAny).r
      : float(0);
    const sampleHydrologyMoisture = (xz: TslAny): TslAny => terrain?.hydrologyTexture
      ? (texture(
          terrain.hydrologyTexture,
          xz.div(Math.max(1, terrain.hydrologyWorldSizeMeters ?? terrain.extentMeters)).clamp(0, 1),
        ) as TslAny).b
      : float(0);
    const sampleCloudShadow = (xz: TslAny): TslAny => terrain?.cloudShadowTexture
      ? (texture(
          terrain.cloudShadowTexture,
          xz.div(Math.max(1, terrain.cloudShadowWorldSizeMeters ?? terrain.extentMeters))
            .add(vec2(time.mul(0.003), time.mul(0.0017)))
            .fract(),
        ) as TslAny).r
      : float(1);

    const sliceDist = (u: TslAny): TslAny => float(nearMeters).mul(float(maxRatio).pow(u));

    this.scatterKernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(width * height * depth), () => {
        Return();
      });

      const x = i.mod(width);
      const y = i.div(width).mod(height);
      const z = i.div(width * height);
      const uv = vec2(float(x).add(0.5).div(width), float(y).add(0.5).div(height));
      const ndc = vec2(uv.x, uv.y.oneMinus()).mul(2).sub(1);
      const clip = vec4(ndc.x, ndc.y, 0.5, 1);
      const viewPosition = mat4(this.uProjectionInverse).mul(clip);
      const dirV = viewPosition.xyz.div(viewPosition.w).normalize();
      const dirW = mat4(this.uCameraWorld).mul(vec4(dirV, 0)).xyz.normalize().toVar();
      const cameraPosition = vec3(this.uCameraPosition);
      const sliceJitter = hashNoise3(vec3(float(x), float(y), float(z))).mul(0.8).add(0.1);
      const dist = sliceDist(float(z).add(sliceJitter).div(depth));
      const worldPos = cameraPosition.add(dirW.mul(dist)).toVar();
      const sunDir = vec3(this.uSunDirection).normalize().toVar();

      const groundY = sampleTerrainHeight(worldPos.xz);
      const heightAboveGround = worldPos.y.sub(groundY).max(0);
      const altitudeLayerStart = float(froxels.groundReferenceHeightMeters + 120);
      const rhoGround = densityAtHeight(heightAboveGround, froxels.groundFalloffMeters)
        .mul(froxels.groundFogDensity);
      const rhoAltitude = densityAtHeight(
        worldPos.y.sub(altitudeLayerStart).max(0),
        froxels.altitudeFalloffMeters,
      ).mul(froxels.altitudeFogDensity);
      const lowSun = float(1).sub(smoothstep(0.08, 0.65, sunDir.y));
      const timeOfDayDensity = lowSun.mul(froxels.sunDensityBoost).add(froxels.ambientDensityFloor);
      const noiseUv = worldPos.xz
        .mul(0.037)
        .add(vec2(time.mul(0.19), time.mul(0.11)))
        .add(vec2(float(z).mul(17.17), float(z).mul(31.31)));
      const noise = hashNoise2(noiseUv)
        .mul(2)
        .sub(1)
        .mul(froxels.noiseStrength)
        .add(1)
        .max(0);
      const hydrologyMoisture = sampleHydrologyMoisture(worldPos.xz);
      const moistureFactor = hydrologyMoisture.mul(hydrologyMoisture).mul(1.5).add(0.25);

      const terrainVisibility = float(1).toVar();
      for (const probeDistance of [12, 30, 75, 180, 420]) {
        const probePos = worldPos.add(sunDir.mul(probeDistance));
        const probeGroundY = sampleTerrainHeight(probePos.xz);
        terrainVisibility.mulAssign(smoothstep(-10, 2, probePos.y.sub(probeGroundY)));
      }

      const crownSlabY = groundY.add(13);
      const crownDeltaY = crownSlabY.sub(worldPos.y);
      const canopyProjection = worldPos.xz.add(
        sunDir.xz.mul(crownDeltaY.max(0).div(sunDir.y.max(0.08))),
      );
      const projectedCanopy = sampleCanopy(canopyProjection);
      const canopyVisibility = crownDeltaY.greaterThan(0).select(
        clamp(float(1).sub(projectedCanopy.mul(0.88)), 0.08, 1),
        float(1),
      );
      const cloudVisibility = sampleCloudShadow(worldPos.xz.add(sunDir.xz.mul(280)));
      const cloudStrength = float(Math.max(0, Math.min(1, terrain?.cloudShadowStrength ?? 0)));
      const cloudVisibilityWeighted = float(1).sub(float(1).sub(cloudVisibility).mul(cloudStrength));
      const sunVisibility = terrainVisibility.mul(canopyVisibility).mul(cloudVisibilityWeighted);

      const density = rhoGround.add(rhoAltitude)
        .mul(noise)
        .mul(timeOfDayDensity)
        .mul(moistureFactor)
        .mul(froxels.strength);
      const phase = phaseHenyeyGreenstein(dirW.dot(sunDir), 0.5);
      const shaftGain = lowSun.mul(froxels.sunShaftsStrength).mul(2).add(1);
      const directScatter = vec3(this.uSunRadiance)
        .mul(phase)
        .mul(shaftGain)
        .mul(sunVisibility);
      const ambientScatter = vec3(this.uSkyRadiance)
        .mul(0.018)
        .mul(sunVisibility.mul(0.6).add(0.4));
      const source = directScatter.add(ambientScatter);
      textureStore(
        this.scatterTexture,
        uvec3(x.toUint(), y.toUint(), z.toUint()),
        vec4(source.mul(density), density),
      ).toWriteOnly();
    })().compute(width * height * depth);
    (this.scatterKernel as ComputeNode).setName?.("postfxFroxelScatter");

    this.integrateKernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(width * height), () => {
        Return();
      });

      const x = i.mod(width);
      const y = i.div(width);
      const transmittance = float(1).toVar();
      const scatter = vec3(0).toVar();

      Loop(depth, ({ i: k }: { readonly i: TslAny }) => {
        const u0 = float(k).div(depth);
        const u1 = float(k).add(1).div(depth);
        const dz = sliceDist(u1).sub(sliceDist(u0));
        const uvw = vec3(
          float(x).add(0.5).div(width),
          float(y).add(0.5).div(height),
          float(k).add(0.5).div(depth),
        );
        const slice = texture3D(this.scatterTexture, uvw, 0) as TslAny;
        const sliceT = exp(slice.a.mul(dz).negate());
        const sliceRadiance = slice.rgb.div(slice.a.max(1e-6)).mul(float(1).sub(sliceT));
        scatter.addAssign(sliceRadiance.mul(transmittance));
        transmittance.mulAssign(sliceT);
        textureStore(
          this.integratedTexture,
          uvec3(x.toUint(), y.toUint(), k.toUint()),
          vec4(scatter, transmittance),
        ).toWriteOnly();
      });
    })().compute(width * height);
    (this.integrateKernel as ComputeNode).setName?.("postfxFroxelIntegrate");
  }

  nodeInput(): PostFxFroxelVolumeNodeInput {
    return {
      integratedTexture: this.integratedTexture,
      nearMeters: this.froxels.nearMeters,
      maxDistanceMeters: this.froxels.maxDistanceMeters,
    };
  }

  update(
    renderer: WebGPURenderer,
    camera: Camera,
    sunDirection: Vector3,
    liveLighting: EnvironmentLighting | null = null,
  ): void {
    camera.updateMatrixWorld();
    const cameraWithInverse = camera as Camera & { projectionMatrixInverse?: Matrix4 };
    this.uProjectionInverse.value.copy(
      cameraWithInverse.projectionMatrixInverse ?? this.projectionInverseScratch.copy(camera.projectionMatrix).invert(),
    );
    this.uCameraWorld.value.copy(camera.matrixWorld);
    this.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    this.uSunDirection.value.copy(sunDirection).normalize();
    // Prefer the live scene lighting so fog light follows GUI/environment state; the default
    // derivation remains a fallback for callers without an environment (tests, previews).
    const lighting = liveLighting ?? deriveEnvironmentLighting(
      this.uSunDirection.value,
      DEFAULT_ENVIRONMENT_SETTINGS,
      DEFAULT_ENVIRONMENT_COLORS,
    );
    this.uSunRadiance.value.set(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b);
    this.uSkyRadiance.value.set(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b);
    renderer.compute(this.scatterKernel);
    renderer.compute(this.integrateKernel);
  }

  dispose(): void {
    this.scatterTexture.dispose?.();
    this.integratedTexture.dispose?.();
  }

  private createTexture(): Storage3DTexture {
    const { width, height, depth } = POSTFX_FROXEL_VOLUME_GRID;
    const texture = new Storage3DTexture(width, height, depth);
    texture.type = HalfFloatType;
    texture.generateMipmaps = false;
    return texture;
  }
}
