import * as THREE from "three";
import { Rng, hashCombine, hashString } from "../core/seed.js";
import { createRainNodeMaterial, createSplashNodeMaterial } from "./rainNodeMaterial.js";
import { createRainShaderMaterial, createSplashShaderMaterial, type RainWeatherShaderHandle } from "./rainShaderMaterial.js";
import {
  HARD_SPLASH_COUNT,
  REPOSITION_DISTANCE,
  SPLASH_AREA,
  TAU,
  WATER_DEPTH_EPSILON,
  WATER_MASK_EPSILON,
  WATER_SPLASH_COUNT,
} from "./rain_constants.js";
import { DEFAULT_RAIN_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createRainGeometry, createSplashGeometry } from "./rain_geometry.js";
import type { RainWeatherOptions, RainWeatherSamplers, RainWeatherSettings, RainWeatherStats, SplashBuffers } from "./rain_types.js";

export class RainWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly rainMaterial: RainWeatherShaderHandle;
  private readonly hardSplashMaterial: RainWeatherShaderHandle;
  private readonly waterSplashMaterial: RainWeatherShaderHandle;
  private readonly rainMesh: THREE.Mesh;
  private readonly hardSplashMesh: THREE.Mesh;
  private readonly waterSplashMesh: THREE.Mesh;
  private readonly hardBuffers: SplashBuffers;
  private readonly waterBuffers: SplashBuffers;
  private readonly samplers: RainWeatherSamplers;
  private readonly worldCells: number;
  private readonly seed: number;
  private readonly placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly rainCenter = new THREE.Vector3();
  private settings = { ...DEFAULT_RAIN_WEATHER_SETTINGS };
  private stats: RainWeatherStats = { hardSplashes: 0, waterSplashes: 0 };

  constructor(options: RainWeatherOptions) {
    this.samplers = options.samplers;
    this.worldCells = options.worldCells;
    this.seed = options.seed ?? 0x8f3d11c7;
    this.group.name = "weather-rain";
    this.group.visible = this.settings.enabled;

    this.rainMaterial = options.isWebGpu ? createRainNodeMaterial() : createRainShaderMaterial();
    this.hardSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("hard") : createSplashShaderMaterial("hard");
    this.waterSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("water") : createSplashShaderMaterial("water");

    this.rainMesh = new THREE.Mesh(createRainGeometry(this.seed), this.rainMaterial.material);
    this.rainMesh.name = "weather-rain-streaks";
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 40;

    const hard = createSplashGeometry(HARD_SPLASH_COUNT);
    this.hardBuffers = hard.buffers;
    this.hardSplashMesh = new THREE.Mesh(hard.geometry, this.hardSplashMaterial.material);
    this.hardSplashMesh.name = "weather-rain-hard-splashes";
    this.hardSplashMesh.frustumCulled = false;
    this.hardSplashMesh.renderOrder = 41;

    const water = createSplashGeometry(WATER_SPLASH_COUNT);
    this.waterBuffers = water.buffers;
    this.waterSplashMesh = new THREE.Mesh(water.geometry, this.waterSplashMaterial.material);
    this.waterSplashMesh.name = "weather-rain-water-splashes";
    this.waterSplashMesh.frustumCulled = false;
    this.waterSplashMesh.renderOrder = 42;

    this.group.add(this.rainMesh, this.hardSplashMesh, this.waterSplashMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: RainWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
      windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    for (const material of [this.rainMaterial, this.hardSplashMaterial, this.waterSplashMaterial]) {
      material.setIntensity(this.settings.intensity);
      material.setWind(this.settings.windX, this.settings.windZ);
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3, focus: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.rainCenter.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    this.rainMaterial.setCenter(this.rainCenter);
    this.rainMaterial.setTime(elapsedSeconds);
    this.hardSplashMaterial.setTime(elapsedSeconds);
    this.waterSplashMaterial.setTime(elapsedSeconds);

    if (
      !Number.isFinite(this.placementCenter.x) ||
      this.placementCenter.distanceToSquared(focus) > REPOSITION_DISTANCE * REPOSITION_DISTANCE
    ) {
      this.placementCenter.copy(focus);
      this.repositionSplashes(focus);
    }
  }

  getStats(): RainWeatherStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.rainMesh.geometry.dispose();
    this.hardSplashMesh.geometry.dispose();
    this.waterSplashMesh.geometry.dispose();
    this.rainMaterial.dispose();
    this.hardSplashMaterial.dispose();
    this.waterSplashMaterial.dispose();
  }

  private repositionSplashes(focus: THREE.Vector3): void {
    const cellX = Math.floor(focus.x / REPOSITION_DISTANCE);
    const cellZ = Math.floor(focus.z / REPOSITION_DISTANCE);
    const placementSeed = hashCombine(hashCombine(this.seed, cellX >>> 0), cellZ >>> 0);
    const hardRng = new Rng(hashCombine(placementSeed, hashString("hard-splashes")));
    const waterRng = new Rng(hashCombine(placementSeed, hashString("water-splashes")));
    const hardCount = this.placeSplashes(this.hardBuffers, "hard", hardRng, focus);
    const waterCount = this.placeSplashes(this.waterBuffers, "water", waterRng, focus);
    this.markSplashAttributesDirty(this.hardSplashMesh.geometry);
    this.markSplashAttributesDirty(this.waterSplashMesh.geometry);
    this.stats = { hardSplashes: hardCount, waterSplashes: waterCount };
  }

  private placeSplashes(buffers: SplashBuffers, kind: "hard" | "water", rng: Rng, focus: THREE.Vector3): number {
    const count = buffers.params.length / 4;
    let active = 0;
    for (let i = 0; i < count; i++) {
      const point = this.findSplashPoint(kind, rng, focus);
      const c = i * 3;
      const p = i * 4;
      if (!point) {
        buffers.center[c] = focus.x;
        buffers.center[c + 1] = focus.y;
        buffers.center[c + 2] = focus.z;
        buffers.normal[c] = 0;
        buffers.normal[c + 1] = 1;
        buffers.normal[c + 2] = 0;
        buffers.params[p] = 0;
        buffers.params[p + 1] = rng.float();
        buffers.params[p + 2] = rng.range(0, TAU);
        buffers.params[p + 3] = 0;
        continue;
      }

      buffers.center[c] = point.x;
      buffers.center[c + 1] = point.y;
      buffers.center[c + 2] = point.z;
      buffers.normal[c] = point.normal.x;
      buffers.normal[c + 1] = point.normal.y;
      buffers.normal[c + 2] = point.normal.z;
      buffers.params[p] = kind === "hard" ? rng.range(0.28, 0.62) : rng.range(0.45, 0.92);
      buffers.params[p + 1] = rng.float();
      buffers.params[p + 2] = rng.range(0, TAU);
      buffers.params[p + 3] = 1;
      active++;
    }
    return active;
  }

  private findSplashPoint(kind: "hard" | "water", rng: Rng, focus: THREE.Vector3): { x: number; y: number; z: number; normal: THREE.Vector3 } | null {
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = THREE.MathUtils.clamp(focus.x + rng.range(-SPLASH_AREA * 0.5, SPLASH_AREA * 0.5), 0, this.worldCells);
      const z = THREE.MathUtils.clamp(focus.z + rng.range(-SPLASH_AREA * 0.5, SPLASH_AREA * 0.5), 0, this.worldCells);
      const water = this.samplers.waterSample(x, z);
      const isWater = water.depth > WATER_DEPTH_EPSILON && water.bodyMask > WATER_MASK_EPSILON;
      if (kind === "water") {
        if (!isWater) continue;
        return { x, y: water.waterY + 0.045, z, normal: new THREE.Vector3(0, 1, 0) };
      }
      if (isWater) continue;
      const [nx, ny, nz] = this.samplers.surfaceNormal(x, z);
      return {
        x,
        y: this.samplers.surfaceHeight(x, z) + 0.06,
        z,
        normal: new THREE.Vector3(nx, ny, nz).normalize(),
      };
    }
    return null;
  }

  private markSplashAttributesDirty(geometry: THREE.BufferGeometry): void {
    for (const key of ["aSplashCenter", "aSplashNormal", "aSplashParams"]) {
      const attr = geometry.getAttribute(key);
      if (attr) attr.needsUpdate = true;
    }
  }
}
