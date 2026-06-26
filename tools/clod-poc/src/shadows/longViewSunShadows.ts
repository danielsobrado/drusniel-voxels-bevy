import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ShadowProxyConfig } from "./shadowProxyTypes.js";

export interface LongViewSunShadowOptions {
  castShadow?: boolean;
}

/**
 * PoC-only directional sun shadow setup for long-view scenes.
 * Production should map this policy to Bevy CSM + far terrain shadow proxy tiles.
 */
export function configureLongViewSunShadows(
  light: THREE.DirectionalLight,
  config: ShadowProxyConfig,
  options: LongViewSunShadowOptions = {},
): void {
  if (options.castShadow !== undefined) {
    light.castShadow = options.castShadow;
  }
  const mapSize = Math.max(256, Math.floor(config.lightShadowMapSize));
  light.shadow.mapSize.set(mapSize, mapSize);
  const extent = config.lightShadowCameraExtentM;
  light.shadow.camera.left = -extent;
  light.shadow.camera.right = extent;
  light.shadow.camera.top = extent;
  light.shadow.camera.bottom = -extent;
  light.shadow.camera.near = config.lightShadowCameraNearM;
  light.shadow.camera.far = config.lightShadowCameraFarM;
  light.shadow.bias = config.lightShadowBias;
  light.shadow.normalBias = config.lightShadowNormalBias;
  light.shadow.camera.updateProjectionMatrix();
}

export function syncLongViewSunLight(
  light: THREE.DirectionalLight,
  lighting: EnvironmentLighting,
  intensity = 2.4,
  target = new THREE.Vector3(0, 0, 0),
): void {
  const dir = lighting.sunDirection.clone().normalize();
  light.position.copy(dir.clone().multiplyScalar(4000).add(target));
  light.target.position.copy(target);
  light.color.copy(lighting.sunColor);
  light.intensity = intensity;
  light.target.updateMatrixWorld();
}

export interface ShadowMapRenderer {
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
}

export function enableRendererShadowMaps(renderer: ShadowMapRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function createLongViewSunLight(
  config: ShadowProxyConfig,
  options: LongViewSunShadowOptions = {},
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xfff0d0, 2.4);
  light.name = "DrusnielLongViewSun";
  configureLongViewSunShadows(light, config, options);
  return light;
}

export function createSunShadowCameraHelper(light: THREE.DirectionalLight): THREE.CameraHelper {
  const helper = new THREE.CameraHelper(light.shadow.camera);
  helper.name = "DrusnielLongViewSunShadowCamera";
  helper.visible = false;
  return helper;
}
