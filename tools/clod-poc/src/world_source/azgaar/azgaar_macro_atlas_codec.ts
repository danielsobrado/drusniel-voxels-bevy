export interface MacroAtlasPayload {
  encoding: string;
  data: string;
  length: number;
}

export interface DecodedMacroAtlas {
  heights: Uint8Array;
  biomes: Uint8Array;
  features: Uint16Array;
}

export interface MacroAtlasSource {
  kind: string;
  version: number;
  atlas: {
    width: number;
    height: number;
    heightData: MacroAtlasPayload;
    biomeData: MacroAtlasPayload;
    featureData: MacroAtlasPayload;
  };
}

export interface MacroAtlasValues {
  heights: Uint8Array;
  biomes: Uint8Array;
  features: Uint16Array;
}

const MACRO_SOURCE_KIND = 'azgaar-macro-v1';
const MACRO_SOURCE_VERSION = 1;
const MAX_ATLAS_RAW_BYTES = 64 * 1024 * 1024;
const UINT8_RAW = 'base64-u8-v1';
const UINT8_RLE = 'base64-rle-u8-v1';
const UINT16_RAW = 'base64-le-u16-v1';
const UINT16_RLE = 'base64-rle-u16-v1';

type BytesPerValue = 1 | 2;
type AtlasValues = Uint8Array | Uint16Array;

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validateAtlasSampleCount(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Macro atlas dimensions must be positive safe integers.');
  }
  const sampleCount = width * height;
  const rawBytes = sampleCount * 4;
  if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(rawBytes)) {
    throw new Error('Macro atlas dimensions are too large.');
  }
  if (rawBytes > MAX_ATLAS_RAW_BYTES) {
    throw new Error('Macro atlas exceeds the supported raw size limit.');
  }
  return sampleCount;
}

function encodeRuns(values: AtlasValues, bytesPerValue: BytesPerValue): Uint8Array {
  const runs: Array<readonly [count: number, value: number]> = [];
  for (let offset = 0; offset < values.length;) {
    const value = values[offset];
    let count = 1;
    while (
      offset + count < values.length
      && values[offset + count] === value
      && count < 0xffff
    ) {
      count += 1;
    }
    runs.push([count, value]);
    offset += count;
  }
  const bytes = new Uint8Array(runs.length * (2 + bytesPerValue));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [count, value] of runs) {
    view.setUint16(offset, count, true);
    offset += 2;
    if (bytesPerValue === 1) {
      view.setUint8(offset, value);
    } else {
      view.setUint16(offset, value, true);
    }
    offset += bytesPerValue;
  }
  return bytes;
}

function encodeValues(values: AtlasValues, bytesPerValue: BytesPerValue): MacroAtlasPayload {
  const raw = new Uint8Array(values.length * bytesPerValue);
  if (bytesPerValue === 1) {
    raw.set(values);
  } else {
    const view = new DataView(raw.buffer);
    for (let index = 0; index < values.length; index += 1) {
      view.setUint16(index * 2, values[index], true);
    }
  }
  const runs = encodeRuns(values, bytesPerValue);
  const useRuns = runs.byteLength < raw.byteLength;
  return {
    encoding: bytesPerValue === 1
      ? (useRuns ? UINT8_RLE : UINT8_RAW)
      : (useRuns ? UINT16_RLE : UINT16_RAW),
    data: bytesToBase64(useRuns ? runs : raw),
    length: values.length,
  };
}

function maximumBase64Length(decodedBytes: number): number {
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0) {
    throw new Error('Macro atlas payload size is invalid.');
  }
  const encodedLength = Math.ceil(decodedBytes / 3) * 4;
  if (!Number.isSafeInteger(encodedLength)) {
    throw new Error('Macro atlas payload size is invalid.');
  }
  return encodedLength;
}

function validatePayload(
  payload: MacroAtlasPayload,
  bytesPerValue: BytesPerValue,
  expectedLength: number,
): { bytes: Uint8Array; rawEncoding: string; rleEncoding: string } {
  if (!Number.isSafeInteger(payload.length) || payload.length !== expectedLength) {
    throw new Error('Macro atlas dimensions do not match its payloads.');
  }
  if (typeof payload.data !== 'string') {
    throw new Error('Macro atlas data must be a base64 string.');
  }

  const rawEncoding = bytesPerValue === 1 ? UINT8_RAW : UINT16_RAW;
  const rleEncoding = bytesPerValue === 1 ? UINT8_RLE : UINT16_RLE;
  const rawBytes = expectedLength * bytesPerValue;
  const rleBytes = expectedLength * (2 + bytesPerValue);
  if (!Number.isSafeInteger(rawBytes) || !Number.isSafeInteger(rleBytes)) {
    throw new Error('Macro atlas payload size is invalid.');
  }

  const maximumDecodedBytes = payload.encoding === rawEncoding
    ? rawBytes
    : payload.encoding === rleEncoding
      ? rleBytes
      : null;
  if (maximumDecodedBytes === null) {
    throw new Error(`Unsupported macro atlas encoding: ${payload.encoding}.`);
  }
  if (payload.data.length > maximumBase64Length(maximumDecodedBytes)) {
    throw new Error('Macro atlas payload exceeds its expected size.');
  }

  const bytes = base64ToBytes(payload.data);
  if (bytes.byteLength > maximumDecodedBytes) {
    throw new Error('Macro atlas payload exceeds its expected size.');
  }
  return { bytes, rawEncoding, rleEncoding };
}

function decodeValuesU8(payload: MacroAtlasPayload, expectedLength: number): Uint8Array {
  const { bytes, rawEncoding } = validatePayload(payload, 1, expectedLength);
  if (payload.encoding === rawEncoding) {
    if (bytes.byteLength !== expectedLength) {
      throw new Error('Macro atlas raw payload has an invalid size.');
    }
    return bytes;
  }
  if (bytes.byteLength % 3 !== 0) {
    throw new Error('Macro atlas RLE payload is invalid.');
  }

  const result = new Uint8Array(expectedLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let target = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const count = view.getUint16(offset, true);
    const value = view.getUint8(offset + 2);
    if (count < 1 || target + count > result.length) {
      throw new Error('Macro atlas RLE payload is invalid.');
    }
    result.fill(value, target, target + count);
    target += count;
  }
  if (target !== result.length) {
    throw new Error('Macro atlas RLE payload is incomplete.');
  }
  return result;
}

function decodeValuesU16(payload: MacroAtlasPayload, expectedLength: number): Uint16Array {
  const { bytes, rawEncoding } = validatePayload(payload, 2, expectedLength);
  const rawBytes = expectedLength * 2;
  if (payload.encoding === rawEncoding) {
    if (bytes.byteLength !== rawBytes) {
      throw new Error('Macro atlas raw payload has an invalid size.');
    }
    const result = new Uint16Array(expectedLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < result.length; index += 1) {
      result[index] = view.getUint16(index * 2, true);
    }
    return result;
  }
  if (bytes.byteLength % 4 !== 0) {
    throw new Error('Macro atlas RLE payload is invalid.');
  }

  const result = new Uint16Array(expectedLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let target = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const count = view.getUint16(offset, true);
    const value = view.getUint16(offset + 2, true);
    if (count < 1 || target + count > result.length) {
      throw new Error('Macro atlas RLE payload is invalid.');
    }
    result.fill(value, target, target + count);
    target += count;
  }
  if (target !== result.length) {
    throw new Error('Macro atlas RLE payload is incomplete.');
  }
  return result;
}

export function createMacroAtlasPayload(values: MacroAtlasValues): {
  heightData: MacroAtlasPayload;
  biomeData: MacroAtlasPayload;
  featureData: MacroAtlasPayload;
} {
  return {
    heightData: encodeValues(values.heights, 1),
    biomeData: encodeValues(values.biomes, 1),
    featureData: encodeValues(values.features, 2),
  };
}

export function decodeMacroAtlas(source: MacroAtlasSource): DecodedMacroAtlas {
  if (source.kind !== MACRO_SOURCE_KIND || source.version !== MACRO_SOURCE_VERSION) {
    throw new Error(`Unsupported base terrain source: ${source.kind || 'unknown'}.`);
  }
  const expected = validateAtlasSampleCount(source.atlas.width, source.atlas.height);
  return {
    heights: decodeValuesU8(source.atlas.heightData, expected),
    biomes: decodeValuesU8(source.atlas.biomeData, expected),
    features: decodeValuesU16(source.atlas.featureData, expected),
  };
}

export function validateMacroAtlasDimensions(width: number, height: number): number {
  return validateAtlasSampleCount(width, height);
}
