import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  normalize,
  positionGeometry,
  uniform,
  vec3,
  wgslFn,
} from "three/tsl";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import deepOceanWgsl from "../shaders/deepOcean.wgsl?raw";
import { extractWgslFunction } from "../shaders/wgslFunction.js";
import {
  buildDeepOceanMeshes,
  type DeepOceanGridMesh,
  type DeepOceanMeshSet,
} from "./deepOceanMesh.js";
import { createCoastOceanTransitionGpu } from "./coastOceanTransition.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export const DEEP_OCEAN_WGSL = deepOceanWgsl;

export interface DeepOceanOptions {
  config: BorderCoastOceanConfig;
  sunDirection: THREE.Vector3;
  seed?: number;
}

export interface DeepOceanStats {
  nearTriangles: number;
  farTriangles: number;
  totalTriangles: number;
  snapUpdates: number;
  drawCalls: number;
  shaderTimeMs: number | null;
}

interface OceanLevelHandle {
  grid: DeepOceanGridMesh;
  mesh: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  setTime(timeSeconds: number): void;
  setSnapOrigin(x: number, z: number): void;
  updateLook(heightScale: number, choppiness: number, foamIntensity: number, fogDensity: number): void;
}

const oceanWave = wgslFn(extractWgslFunction(DEEP_OCEAN_WGSL, "ocean_wave"));
const oceanWaveSample = wgslFn(
  extractWgslFunction(DEEP_OCEAN_WGSL, "deep_ocean_wave_sample"),
  [oceanWave] as any,
);
const oceanOutsideDistance = wgslFn(
  extractWgslFunction(DEEP_OCEAN_WGSL, "deep_ocean_outside_distance"),
);
const oceanShade = wgslFn(
  extractWgslFunction(DEEP_OCEAN_WGSL, "deep_ocean_shade"),
  [oceanOutsideDistance] as any,
);

export class DeepOcean {
  readonly object = new THREE.Group();
  readonly pageSourceKind = "deepOcean" as const;
  readonly collisionEnabled = false;
  readonly renderOnly = true;

  private readonly levels: OceanLevelHandle[];
  private timeSeconds = 0;
  private snapUpdates = 0;
  private shaderTimeMs: number | null = null;

  constructor(options: DeepOceanOptions) {
    const grids = buildDeepOceanMeshes(options.config.deep_ocean);
    this.object.name = "deep-ocean-render-only";
    this.object.visible = options.config.deep_ocean.enabled;
    this.object.userData["pageSourceKind"] = this.pageSourceKind;
    this.object.userData["renderOnly"] = true;
    this.object.userData["collisionEnabled"] = false;
    this.object.userData["waveEvaluation"] = "gpu-wgsl";
    this.levels = [
      createOceanLevel(grids.near, options, 0),
      createOceanLevel(grids.far, options, 1),
    ];
    for (const level of this.levels) this.object.add(level.mesh);
  }

  update(deltaSeconds: number, cameraWorldPosition: THREE.Vector3): void {
    if (!this.object.visible) return;
    this.timeSeconds += Math.max(0, deltaSeconds);
    for (const level of this.levels) {
      level.setTime(this.timeSeconds);
      const snappedX = Math.floor(cameraWorldPosition.x / level.grid.snapM) * level.grid.snapM;
      const snappedZ = Math.floor(cameraWorldPosition.z / level.grid.snapM) * level.grid.snapM;
      if (level.mesh.position.x !== snappedX || level.mesh.position.z !== snappedZ) {
        level.mesh.position.set(snappedX, 0, snappedZ);
        level.setSnapOrigin(snappedX, snappedZ);
        this.snapUpdates += 1;
      }
    }
  }

  stats(): DeepOceanStats {
    const nearTriangles = this.levels[0].grid.triangleCount;
    const farTriangles = this.levels[1].grid.triangleCount;
    return {
      nearTriangles,
      farTriangles,
      totalTriangles: nearTriangles + farTriangles,
      snapUpdates: this.snapUpdates,
      drawCalls: this.object.visible ? this.levels.length : 0,
      shaderTimeMs: this.shaderTimeMs,
    };
  }

  setEnabled(enabled: boolean): void {
    this.object.visible = enabled;
  }

  updateLook(heightScale: number, choppiness: number, foamIntensity: number, fogDensity: number): void {
    for (const level of this.levels) {
      level.updateLook(heightScale, choppiness, foamIntensity, fogDensity);
    }
  }

  setShaderTimeMs(shaderTimeMs: number | null): void {
    this.shaderTimeMs = shaderTimeMs !== null && Number.isFinite(shaderTimeMs)
      ? Math.max(0, shaderTimeMs)
      : null;
  }

  dispose(): void {
    for (const level of this.levels) {
      level.mesh.geometry.dispose();
      level.mesh.material.dispose();
    }
    this.object.clear();
  }
}

function createOceanLevel(
  grid: DeepOceanGridMesh,
  options: DeepOceanOptions,
  levelId: number,
): OceanLevelHandle {
  const ocean = options.config.deep_ocean;
  const wave = ocean.wave;
  const shading = ocean.shading;
  const bounds = options.config.world.bounds;
  const uTime = uniform(0);
  const uSnapOrigin = uniform(new THREE.Vector2());
  const uWaterLevel = uniform(options.config.world.water_level);
  const uBounds = uniform(new THREE.Vector4(
    bounds.min_x,
    bounds.max_x,
    bounds.min_z,
    bounds.max_z,
  ));
  const windRadians = wave.wind_direction_deg * Math.PI / 180;
  const uWind = uniform(new THREE.Vector2(Math.cos(windRadians), Math.sin(windRadians)));
  const uWave = uniform(new THREE.Vector4(
    wave.wind_speed,
    wave.height_scale,
    wave.choppiness,
    levelId,
  ));
  const uPatch = uniform(new THREE.Vector4(
    wave.coarse_patch_m,
    wave.fine_patch_m,
    wave.foam_threshold,
    wave.foam_power,
  ));
  const uFoamIntensity = uniform(wave.foam_intensity);
  const uLevelFade = uniform(new THREE.Vector4(
    grid.innerFadeM,
    grid.innerFadeM + grid.snapM * 4,
    grid.outerFadeM * 0.82,
    grid.outerFadeM,
  ));
  const uStartOutside = uniform(ocean.start_outside_border_m);
  const uDeepColor = uniform(new THREE.Color(shading.deep_color));
  const uShallowColor = uniform(new THREE.Color(shading.shallow_color));
  const uFoamColor = uniform(new THREE.Color(shading.foam_color));
  const uFogColor = uniform(new THREE.Color(shading.fog_color));
  const uShading = uniform(new THREE.Vector4(
    shading.fresnel_power,
    shading.fresnel_strength,
    shading.reflection_strength,
    shading.reflection_distortion,
  ));
  const uFog = uniform(new THREE.Vector4(
    shading.fog_near_m,
    shading.fog_far_m,
    shading.fog_density,
    shading.roughness,
  ));
  const uSun = uniform(options.sunDirection.clone().normalize());

  const worldXZ: TslNode = positionGeometry.xz.add(uSnapOrigin);
  const transition = createCoastOceanTransitionGpu(
    worldXZ,
    options.config,
    options.seed ?? 1,
  );
  const uCoastBehavior = uniform(new THREE.Vector4(
    options.config.surf.beach_foam_width_m,
    options.config.surf.cliff_foam_width_m,
    options.config.surf.reef_foam_width_m,
    options.config.surf.shore_wave_height,
  ));
  const waveSample: TslNode = oceanWaveSample({
    world_xz: worldXZ,
    time_seconds: uTime,
    wind_direction: uWind,
    wave_params: uWave,
    patch_params: uPatch,
    transition_primary: transition.primary,
    transition_secondary: transition.secondary,
    coast_behavior: uCoastBehavior,
  });
  const displaced = vec3(
    positionGeometry.x.add(waveSample.y),
    uWaterLevel.add(waveSample.x),
    positionGeometry.z.add(waveSample.z),
  );
  const normalNode = normalize(vec3(waveSample.y.negate(), 1, waveSample.z.negate()));
  const worldPosition = displaced.add(vec3(uSnapOrigin.x, 0, uSnapOrigin.y));
  const colorNode: TslNode = oceanShade({
    world_position: worldPosition,
    normal_value: normalNode,
    camera_position: cameraPosition,
    sun_direction: uSun,
    bounds: uBounds,
    start_outside_m: uStartOutside,
    level_fade: uLevelFade,
    deep_color: uDeepColor,
    shallow_color: uShallowColor,
    foam_color: uFoamColor,
    fog_color: uFogColor,
    shading_params: uShading,
    fog_params: uFog,
    foam_value: waveSample.w.mul(uFoamIntensity),
    transition_primary: transition.primary,
    transition_secondary: transition.secondary,
  });

  const material = new MeshBasicNodeMaterial();
  material.name = `deep-ocean-${grid.level}`;
  material.positionNode = displaced;
  material.colorNode = colorNode.xyz;
  material.opacityNode = colorNode.w;
  material.maskNode = colorNode.w.greaterThan(0.001);
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(grid.geometry, material);
  mesh.name = `deep-ocean-${grid.level}`;
  mesh.renderOrder = grid.level === "near" ? 9 : 8;
  mesh.frustumCulled = false;
  mesh.userData["pageSourceKind"] = "deepOcean";
  mesh.userData["collisionEnabled"] = false;
  mesh.userData["cornerCoverage"] = true;
  mesh.userData["level"] = grid.level;

  return {
    grid,
    mesh,
    setTime(timeSeconds) {
      uTime.value = Math.max(0, timeSeconds);
    },
    setSnapOrigin(x, z) {
      uSnapOrigin.value.set(x, z);
    },
    updateLook(heightScale, choppiness, foamIntensity, fogDensity) {
      uWave.value.y = Math.max(0, heightScale);
      uWave.value.z = Math.max(0, choppiness);
      uFoamIntensity.value = Math.max(0, foamIntensity);
      uFog.value.z = Math.max(0, fogDensity);
    },
  };
}

export function deepOceanMeshSet(config: BorderCoastOceanConfig): DeepOceanMeshSet {
  return buildDeepOceanMeshes(config.deep_ocean);
}
