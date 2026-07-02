import type { TerrainMaterialCacheFormat } from "./terrainMaterialCacheConfig.js";
import type { TerrainMaterialChannel, TerrainMaterialCacheKey } from "./terrainMaterialCacheTypes.js";

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function packUnorm8(value: number): number {
  return Math.round(clamp01(value) * 255);
}

export function packSnormToUnorm8(value: number): number {
  return packUnorm8(value * 0.5 + 0.5);
}

export function estimateChannelBytes(channel: TerrainMaterialChannel | undefined): number {
  return channel?.available ? channel.data.byteLength : 0;
}

export function estimatePayloadBytes(payload: {
  macroTint?: TerrainMaterialChannel;
  slopeCurvature?: TerrainMaterialChannel;
  materialWeights?: TerrainMaterialChannel;
  wetnessShoreline?: TerrainMaterialChannel;
  farColor?: TerrainMaterialChannel;
  farNormal?: TerrainMaterialChannel;
  coverage?: TerrainMaterialChannel;
}): number {
  return estimateChannelBytes(payload.macroTint)
    + estimateChannelBytes(payload.slopeCurvature)
    + estimateChannelBytes(payload.materialWeights)
    + estimateChannelBytes(payload.wetnessShoreline)
    + estimateChannelBytes(payload.farColor)
    + estimateChannelBytes(payload.farNormal)
    + estimateChannelBytes(payload.coverage);
}

export function formatProfileForKey(key: TerrainMaterialCacheKey): string {
  return key.formatProfile;
}

export function createUnavailableChannel(format: TerrainMaterialCacheFormat, width: number, height: number): TerrainMaterialChannel<Uint8Array> {
  return { data: new Uint8Array(0), width, height, format, available: false };
}

export function createUint8Channel(data: Uint8Array, width: number, height: number, format: TerrainMaterialCacheFormat): TerrainMaterialChannel<Uint8Array> {
  return { data, width, height, format, available: true };
}

export function createUint16Channel(data: Uint16Array, width: number, height: number, format: TerrainMaterialCacheFormat): TerrainMaterialChannel<Uint16Array> {
  return { data, width, height, format, available: true };
}
