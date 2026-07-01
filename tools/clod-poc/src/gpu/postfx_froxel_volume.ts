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
  originX: number;
  originZ: number;
  extentMeters: number;
}

export interface PostFxFroxelVolumeOptions {
  terrain?: PostFxFroxelVolumeTerrainInput | null;
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
    const hillaire = settings.hillaire;
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
      const hGround = worldPos.y.sub(groundY).max(0);
      const rhoGround = densityAtHeight(hGround, froxels.groundFalloffMeters).mul(froxels.groundFogDensity);
      const rhoAlt = densityAtHeight(worldPos.y, froxels.altitudeFalloffMeters).mul(froxels.altitudeFogDensity);
      const lowSun = float(1).sub(smoothstep(0.08, 0.65, sunDir.y));
      const densitySunScale = lowSun.mul(froxels.sunDensityBoost).add(froxels.ambientDensityFloor);
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
      const canopyCoverage = sampleCanopy(worldPos.xz);
      const moistureBoost = canopyCoverage.mul(0.45).add(1);
      const terrainVisibility = float(1).toVar();
      for (const probeDistance of [24, 60, 140, 320, 720]) {
        const probePos = worldPos.add(sunDir.mul(probeDistance));
        const probeGroundY = sampleTerrainHeight(probePos.xz);
        terrainVisibility.mulAssign(smoothstep(-6, 4, probePos.y.sub(probeGroundY)));
      }
      const crownBase = groundY.add(3);
      const crownTop = groundY.add(21);
      const crownBand = smoothstep(crownBase, crownBase.add(5), worldPos.y)
        .mul(float(1).sub(smoothstep(crownTop.sub(5), crownTop, worldPos.y)));
      const canopyProjection = worldPos.xz.add(
        sunDir.xz.mul(crownTop.sub(worldPos.y).max(0).div(sunDir.y.max(0.08))),
      );
      const projectedCanopy = sampleCanopy(canopyProjection);
      const canopyVisibility = clamp(float(1).sub(projectedCanopy.mul(0.85).mul(crownBand)), 0.15, 1);
      const sunVisibility = terrainVisibility.mul(canopyVisibility);
      const shaft = lowSun.mul(froxels.sunShaftsStrength).add(1);
      const density = rhoGround.add(rhoAlt).mul(noise).mul(densitySunScale).mul(moistureBoost).mul(froxels.strength);
      const phase = phaseHenyeyGreenstein(dirW.dot(sunDir), 0.5);
      const fogColor = vec3(...hillaire.mieColor)
        .mul(phase.mul(18).mul(shaft).mul(sunVisibility))
        .add(vec3(...hillaire.rayleighColor).mul(0.035).mul(float(0.6).add(sunVisibility.mul(0.4))));
      textureStore(
        this.scatterTexture,
        uvec3(x.toUint(), y.toUint(), z.toUint()),
        vec4(fogColor.mul(density), density),
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

  update(renderer: WebGPURenderer, camera: Camera, sunDirection: Vector3): void {
    camera.updateMatrixWorld();
    const cameraWithInverse = camera as Camera & { projectionMatrixInverse?: Matrix4 };
    this.uProjectionInverse.value.copy(
      cameraWithInverse.projectionMatrixInverse ?? this.projectionInverseScratch.copy(camera.projectionMatrix).invert(),
    );
    this.uCameraWorld.value.copy(camera.matrixWorld);
    this.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    this.uSunDirection.value.copy(sunDirection).normalize();
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
