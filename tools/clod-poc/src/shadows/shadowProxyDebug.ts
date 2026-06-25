import type { ShadowProxyConfig } from "./shadowProxyTypes.js";

export interface ShadowProxyDebugState {
  shadowProxyEnabled: boolean;
  sunShadowsEnabled: boolean;
  debugVisibleProxy: boolean;
  debugWireframe: boolean;
  debugFreezeProxy: boolean;
  debugShowBounds: boolean;
  debugLambertFarShellReceiver: boolean;
  showSunShadowCamera: boolean;
  heightBiasM: number;
  lightShadowBias: number;
  lightShadowNormalBias: number;
  lightShadowMapSize: number;
  shadowProxyStatsLine: string;
}

export function createShadowProxyDebugState(
  config: ShadowProxyConfig,
  sunShadowsEnabled: boolean,
): ShadowProxyDebugState {
  return {
    shadowProxyEnabled: config.enabled,
    sunShadowsEnabled,
    debugVisibleProxy: config.debugVisibleProxy,
    debugWireframe: config.debugWireframe,
    debugFreezeProxy: config.debugFreezeProxy,
    debugShowBounds: config.debugShowBounds,
    debugLambertFarShellReceiver: false,
    showSunShadowCamera: false,
    heightBiasM: config.heightBiasM,
    lightShadowBias: config.lightShadowBias,
    lightShadowNormalBias: config.lightShadowNormalBias,
    lightShadowMapSize: config.lightShadowMapSize,
    shadowProxyStatsLine: "shadow proxy: pending",
  };
}

export function shadowProxyDebugStateToConfig(
  state: ShadowProxyDebugState,
  base: ShadowProxyConfig,
): ShadowProxyConfig {
  return {
    ...base,
    enabled: state.shadowProxyEnabled,
    debugVisibleProxy: state.debugVisibleProxy,
    debugWireframe: state.debugWireframe,
    debugFreezeProxy: state.debugFreezeProxy,
    debugShowBounds: state.debugShowBounds,
    heightBiasM: state.heightBiasM,
    lightShadowBias: state.lightShadowBias,
    lightShadowNormalBias: state.lightShadowNormalBias,
    lightShadowMapSize: state.lightShadowMapSize,
  };
}
