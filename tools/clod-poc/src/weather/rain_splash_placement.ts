import * as THREE from "three";
import { Rng, hashCombine, hashString } from "../core/seed.js";
import {
  REPOSITION_DISTANCE,
  SPLASH_AREA,
  TAU,
  WATER_DEPTH_EPSILON,
  WATER_MASK_EPSILON,
} from "./rain_constants.js";
import type { RainWeatherSamplers, RainWeatherStats, SplashBuffers } from "./rain_types.js";

type SplashKind = "hard" | "water";

type SplashPoint = {
  x: number;
  y: number;
  z: number;
  normal: THREE.Vector3;
};

export class RainSplashPlacement {
  constructor(
    private readonly samplers: RainWeatherSamplers,
    private readonly worldCells: number,
    private readonly seed: number,
  ) {}

  reposition(
    focus: THREE.Vector3,
    hardBuffers: SplashBuffers,
    waterBuffers: SplashBuffers,
    hardGeometry: THREE.BufferGeometry,
    waterGeometry: THREE.BufferGeometry,
  ): RainWeatherStats {
    const cellX = Math.floor(focus.x / REPOSITION_DISTANCE);
    const cellZ = Math.floor(focus.z / REPOSITION_DISTANCE);
    const placementSeed = hashCombine(hashCombine(this.seed, cellX >>> 0), cellZ >>> 0);
    const hardRng = new Rng(hashCombine(placementSeed, hashString("hard-splashes")));
    const waterRng = new Rng(hashCombine(placementSeed, hashString("water-splashes")));
    const hardSplashes = this.place(hardBuffers, "hard", hardRng, focus);
    const waterSplashes = this.place(waterBuffers, "water", waterRng, focus);
    markSplashAttributesDirty(hardGeometry);
    markSplashAttributesDirty(waterGeometry);
    return { hardSplashes, waterSplashes };
  }

  private place(buffers: SplashBuffers, kind: SplashKind, rng: Rng, focus: THREE.Vector3): number {
    const count = buffers.params.length / 4;
    let active = 0;
    for (let i = 0; i < count; i++) {
      const point = this.findPoint(kind, rng, focus);
      const c = i * 3;
      const p = i * 4;
      if (!point) {
        writeInactiveSplash(buffers, c, p, rng, focus);
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

  private findPoint(kind: SplashKind, rng: Rng, focus: THREE.Vector3): SplashPoint | null {
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
}

function writeInactiveSplash(buffers: SplashBuffers, centerOffset: number, paramOffset: number, rng: Rng, focus: THREE.Vector3): void {
  buffers.center[centerOffset] = focus.x;
  buffers.center[centerOffset + 1] = focus.y;
  buffers.center[centerOffset + 2] = focus.z;
  buffers.normal[centerOffset] = 0;
  buffers.normal[centerOffset + 1] = 1;
  buffers.normal[centerOffset + 2] = 0;
  buffers.params[paramOffset] = 0;
  buffers.params[paramOffset + 1] = rng.float();
  buffers.params[paramOffset + 2] = rng.range(0, TAU);
  buffers.params[paramOffset + 3] = 0;
}

function markSplashAttributesDirty(geometry: THREE.BufferGeometry): void {
  for (const key of ["aSplashCenter", "aSplashNormal", "aSplashParams"]) {
    const attr = geometry.getAttribute(key);
    if (attr) attr.needsUpdate = true;
  }
}
