import type { LongViewSunShadowsConfig, ShadowProxyConfig } from "../shadows/shadowProxyTypes.js";

export const DEFAULT_SHADOW_PROXY_CONFIG: ShadowProxyConfig = {
  enabled: true,
  gridRes: 512,
  startM: 192,
  endM: 4096,
  heightBiasM: 0.75,
  minHeightM: -256,
  maxHeightM: 512,
  edgeFadeM: 256,
  castShadow: true,
  receiveShadow: false,
  mainPassColorWrite: false,
  mainPassDepthWrite: false,
  shadowSide: "double",
  lightShadowMapSize: 2048,
  lightShadowCameraExtentM: 4096,
  lightShadowCameraNearM: 1,
  lightShadowCameraFarM: 8192,
  lightShadowBias: -0.00015,
  lightShadowNormalBias: 0.5,
  debugVisibleProxy: false,
  debugWireframe: false,
  debugFreezeProxy: false,
  debugShowBounds: false,
};

export const DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG: LongViewSunShadowsConfig = {
  enabled: true,
  shadowProxy: DEFAULT_SHADOW_PROXY_CONFIG,
};
