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

function createUnavailableTypedChannel<T extends Uint8Array | Uint16Array | Float32Array>(
  format: TerrainMaterialCacheFormat,
  width: number,
  height: number,
): TerrainMaterialChannel<T> {
  return { data: new Uint8Array(0) as unknown as T, width, height, format, available: false };
}

export function createUnavailableChannel(format: TerrainMaterialCacheFormat, width: number, height: number): TerrainMaterialChannel<Uint8Array> {
  return createUnavailableTypedChannel(format, width, height);
}

export function createUint8Channel(data: Uint8Array, width: number, height: number, format: TerrainMaterialCacheFormat): TerrainMaterialChannel<Uint8Array> {
  if (format === "none") return createUnavailableTypedChannel(format, width, height);
  return { data, width, height, format, available: true };
}

export function createUint16Channel(data: Uint16Array, width: number, height: number, format: TerrainMaterialCacheFormat): TerrainMaterialChannel<Uint16Array> {
  if (format === "none") return createUnavailableTypedChannel(format, width, height);
  return { data, width, height, format, available: true };
}
