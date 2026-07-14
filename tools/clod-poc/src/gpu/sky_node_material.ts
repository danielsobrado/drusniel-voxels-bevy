// WebGPU sky dome material: horizon/zenith/ground gradient + haze + sun disk/glow.
// The dome and scene lighting share the transmittance-tinted environment model.

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
import { deriveEnvironmentLighting } from "../environment/lighting_model.js";

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
  const initialDirection = sunDirectionFromAngles(settings.sunAzimuthDeg, settings.sunElevationDeg);
  const initialLighting = deriveEnvironmentLighting(initialDirection, settings, colors);
  const uSunDir = uniform(initialDirection.clone());
  const uZenith = uniform(v3(colors.zenith));
  const uHorizon = uniform(v3(colors.horizon));
  const uGround = uniform(v3(colors.ground));
  const uSunColor = uniform(v3(initialLighting.sunColor));
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
    lighting: initialLighting,
    updateSettings(next) {
      currentSettings = { ...next };
      const nextDirection = sunDirectionFromAngles(next.sunAzimuthDeg, next.sunElevationDeg);
      const nextLighting = deriveEnvironmentLighting(nextDirection, next, colors);
      uSunDir.value.copy(nextDirection);
      uSunColor.value.copy(v3(nextLighting.sunColor));
      uSkyIntensity.value = next.skyIntensity;
      uGroundIntensity.value = next.groundIntensity;
      uHorizonSoftness.value = Math.max(next.horizonSoftness, 0.01);
      uSunDiskIntensity.value = next.sunDiskIntensity;
      uSunGlowIntensity.value = next.sunGlowIntensity;
      uHazeIntensity.value = next.hazeIntensity;
      handle.lighting = nextLighting;
    },
  };
  void currentSettings;
  return handle;
}
