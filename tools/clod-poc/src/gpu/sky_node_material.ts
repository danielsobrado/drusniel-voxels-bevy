// Phase 3 WebGPU sky dome (docs/webgpu-migration.md). TSL port of the SKY_FRAG gradient in
// src/environment.ts: horizon/zenith/ground gradient + haze + sun disk/glow. Rendered on a
// BackSide dome that follows the camera (depth off, drawn first). Also returns the derived
// EnvironmentLighting so the terrain material can be lit by the same sun.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  exp,
  max,
  mix,
  normalize,
  positionGeometry,
  pow,
  smoothstep,
  uniform,
} from "three/tsl";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  sunDirectionFromAngles,
  type EnvironmentColors,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "../environment/environment.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

export interface SkyNodeHandle {
  material: MeshBasicNodeMaterial;
  lighting: EnvironmentLighting;
  updateSettings(settings: EnvironmentSettings): void;
}

export function createSkyNodeMaterial(
  settings: EnvironmentSettings = DEFAULT_ENVIRONMENT_SETTINGS,
  colors: EnvironmentColors = DEFAULT_ENVIRONMENT_COLORS,
): SkyNodeHandle {
  const sunDir = sunDirectionFromAngles(settings.sunAzimuthDeg, settings.sunElevationDeg);
  const uSunDir = uniform(sunDir.clone());
  const uZenith = uniform(v3(colors.zenith));
  const uHorizon = uniform(v3(colors.horizon));
  const uGround = uniform(v3(colors.ground));
  const uSunColor = uniform(v3(colors.sun).multiplyScalar(settings.sunIntensity));
  const uSkyIntensity = uniform(settings.skyIntensity);
  const uGroundIntensity = uniform(settings.groundIntensity);
  const uHorizonSoftness = uniform(Math.max(settings.horizonSoftness, 0.01));
  const uSunDiskIntensity = uniform(settings.sunDiskIntensity);
  const uSunGlowIntensity = uniform(settings.sunGlowIntensity);
  const uHazeIntensity = uniform(settings.hazeIntensity);
  let currentSettings = { ...settings };

  const dir: TslNode = normalize(positionGeometry);
  const up = clamp(dir.y.mul(0.5).add(0.5), 0, 1);
  const skyGradient = pow(up, uHorizonSoftness);
  const upperSky = mix(uHorizon, uZenith, skyGradient).mul(uSkyIntensity);
  const groundBlend = smoothstep(-0.18, 0.03, dir.y);
  let sky: TslNode = mix(uGround.mul(uGroundIntensity), upperSky, groundBlend);

  // haze = exp(-abs(dir.y) * 12) * hazeIntensity, blended toward the horizon colour.
  const haze = exp(abs(dir.y).mul(-12)).mul(uHazeIntensity);
  sky = mix(sky, uHorizon.mul(uSkyIntensity), clamp(haze, 0, 1));

  const sunDot = max(dot(dir, uSunDir), 0);
  const aboveHorizon = smoothstep(-0.02, 0.02, dir.y);
  const sunDisk = smoothstep(0.9995, 0.9999, sunDot).mul(uSunDiskIntensity);
  const sunGlow = pow(sunDot, 18).mul(0.18).mul(uSunGlowIntensity);
  sky = sky.add(uSunColor.mul(sunDisk.add(sunGlow)).mul(aboveHorizon));

  const material = new MeshBasicNodeMaterial();
  material.colorNode = sky;
  material.side = THREE.BackSide;
  material.depthTest = false;
  material.depthWrite = false;

  const handle: SkyNodeHandle = {
    material,
    lighting: {
      sunDirection: sunDirectionFromAngles(currentSettings.sunAzimuthDeg, currentSettings.sunElevationDeg),
      sunColor: colors.sun.clone().multiplyScalar(currentSettings.sunIntensity),
      skyLight: colors.skyLight.clone().multiplyScalar(currentSettings.skyIntensity),
      groundLight: colors.groundLight.clone().multiplyScalar(currentSettings.groundIntensity),
    },
    updateSettings(next) {
      currentSettings = { ...next };
      const nextSunDirection = sunDirectionFromAngles(next.sunAzimuthDeg, next.sunElevationDeg);
      uSunDir.value.copy(nextSunDirection);
      uSunColor.value.copy(v3(colors.sun)).multiplyScalar(next.sunIntensity);
      uSkyIntensity.value = next.skyIntensity;
      uGroundIntensity.value = next.groundIntensity;
      uHorizonSoftness.value = Math.max(next.horizonSoftness, 0.01);
      uSunDiskIntensity.value = next.sunDiskIntensity;
      uSunGlowIntensity.value = next.sunGlowIntensity;
      uHazeIntensity.value = next.hazeIntensity;
      handle.lighting = {
        sunDirection: nextSunDirection,
        sunColor: colors.sun.clone().multiplyScalar(next.sunIntensity),
        skyLight: colors.skyLight.clone().multiplyScalar(next.skyIntensity),
        groundLight: colors.groundLight.clone().multiplyScalar(next.groundIntensity),
      };
    },
  };
  return handle;
}
