const CARTOGRAPHY_KIND = 'azgaar-cartography-v1' as const;
const CARTOGRAPHY_VERSION = 1 as const;
const BINARY_ENCODING = 'base64-le-v1' as const;
const MAX_VERTEX_COUNT = 2_000_000;
const MAX_CELL_COUNT = 1_000_000;
const MAX_VERTEX_REFERENCE_COUNT = 12_000_000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type NumberFormatName = 'u8' | 'u32' | 'f32';
type NumericArray = Uint8Array | Uint32Array | Float32Array;

interface NumberFormat {
  bytes: number;
  read: (view: DataView, offset: number) => number;
  write: (view: DataView, offset: number, value: number) => void;
}

interface EncodedVertices {
  count: number;
  ids: string;
  points: string;
}

interface EncodedCells {
  count: number;
  vertexReferenceCount: number;
  ids: string;
  centers: string;
  vertexOffsets: string;
  vertexIds: string;
  heights: string;
  biomes: string;
  features: string;
  states: string;
  provinces: string;
  cultures: string;
  religions: string;
  burgs: string;
}

export interface AzgaarCartographySource {
  kind: typeof CARTOGRAPHY_KIND;
  version: typeof CARTOGRAPHY_VERSION;
  encoding: typeof BINARY_ENCODING;
  width: number;
  height: number;
  vertices: EncodedVertices;
  cells: EncodedCells;
}

export interface DecodedAzgaarCartographySource {
  width: number;
  height: number;
  vertexIds: Uint32Array;
  vertexPoints: Float32Array;
  cellIds: Uint32Array;
  cellCenters: Float32Array;
  vertexOffsets: Uint32Array;
  cellVertexIds: Uint32Array;
  heights: Uint8Array;
  biomes: Uint8Array;
  features: Uint32Array;
  states: Uint32Array;
  provinces: Uint32Array;
  cultures: Uint32Array;
  religions: Uint32Array;
  burgs: Uint32Array;
}

const NUMBER_FORMATS: Readonly<Record<NumberFormatName, NumberFormat>> = Object.freeze({
  u8: Object.freeze({
    bytes: 1,
    read: (view: DataView, offset: number) => view.getUint8(offset),
    write: (view: DataView, offset: number, value: number) => view.setUint8(offset, value),
  }),
  u32: Object.freeze({
    bytes: 4,
    read: (view: DataView, offset: number) => view.getUint32(offset, true),
    write: (view: DataView, offset: number, value: number) => view.setUint32(offset, value, true),
  }),
  f32: Object.freeze({
    bytes: 4,
    read: (view: DataView, offset: number) => view.getFloat32(offset, true),
    write: (view: DataView, offset: number, value: number) => view.setFloat32(offset, value, true),
  }),
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

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

function maximumBase64Length(decodedBytes: number): number {
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0) {
    throw new Error('Azgaar cartography payload size is invalid.');
  }
  const encodedLength = Math.ceil(decodedBytes / 3) * 4;
  if (!Number.isSafeInteger(encodedLength)) {
    throw new Error('Azgaar cartography payload size is invalid.');
  }
  return encodedLength;
}

function base64ToBytes(value: unknown, label: string, maximumDecodedBytes: number): Uint8Array {
  if (typeof value !== 'string') {
    throw new Error(`Azgaar cartography ${label} must be a base64 string.`);
  }
  if (!BASE64_PATTERN.test(value)) {
    throw new Error(`Azgaar cartography ${label} is not valid base64.`);
  }
  if (value.length > maximumBase64Length(maximumDecodedBytes)) {
    throw new Error(`Azgaar cartography ${label} exceeds its expected size.`);
  }
  try {
    const bytes = typeof Buffer !== 'undefined'
      ? new Uint8Array(Buffer.from(value, 'base64'))
      : (() => {
        const binary = atob(value);
        const result = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          result[index] = binary.charCodeAt(index);
        }
        return result;
      })();
    if (bytes.byteLength > maximumDecodedBytes) {
      throw new Error(`Azgaar cartography ${label} exceeds its expected size.`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds its expected size')) {
      throw error;
    }
    throw new Error(`Azgaar cartography ${label} is not valid base64.`);
  }
}

function encodeNumbers(values: ArrayLike<number>, formatName: NumberFormatName): string {
  const format = NUMBER_FORMATS[formatName];
  const byteLength = values.length * format.bytes;
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('Azgaar cartography payload size is invalid.');
  }
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    format.write(view, index * format.bytes, values[index] ?? 0);
  }
  return bytesToBase64(bytes);
}

function decodeNumbers(
  encoded: unknown,
  count: number,
  formatName: 'u8',
  label: string,
): Uint8Array;
function decodeNumbers(
  encoded: unknown,
  count: number,
  formatName: 'u32',
  label: string,
): Uint32Array;
function decodeNumbers(
  encoded: unknown,
  count: number,
  formatName: 'f32',
  label: string,
): Float32Array;
function decodeNumbers(
  encoded: unknown,
  count: number,
  formatName: NumberFormatName,
  label: string,
): NumericArray {
  const format = NUMBER_FORMATS[formatName];
  const expectedBytes = count * format.bytes;
  if (!Number.isSafeInteger(expectedBytes)) {
    throw new Error(`Azgaar cartography ${label} has an invalid size.`);
  }
  const bytes = base64ToBytes(encoded, label, expectedBytes);
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `Azgaar cartography ${label} has ${bytes.byteLength} bytes; expected ${expectedBytes}.`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: NumericArray = formatName === 'u8'
    ? new Uint8Array(count)
    : formatName === 'u32'
      ? new Uint32Array(count)
      : new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    result[index] = format.read(view, index * format.bytes);
  }
  return result;
}

function requirePositiveDimension(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Azgaar cartography requires a positive ${label}.`);
  }
  return numeric;
}

function requireCount(value: unknown, maximum: number, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > maximum) {
    throw new Error(`Azgaar cartography has an invalid ${label}.`);
  }
  return numeric;
}

function requireId(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    throw new Error(`Azgaar cartography ${label} must be an unsigned 32-bit integer.`);
  }
  return numeric;
}

function requirePoint(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`Azgaar cartography ${label} must contain finite x/y coordinates.`);
  }
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Azgaar cartography ${label} must contain finite x/y coordinates.`);
  }
  return [x, y];
}

function requireUniqueIds(ids: Uint32Array, label: string): Set<number> {
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Azgaar cartography has duplicate ${label} id ${id}.`);
    }
    seen.add(id);
  }
  return seen;
}

function classificationId(cell: Record<string, unknown>, key: string): number {
  const numeric = Number(cell[key] ?? 0);
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff ? numeric : 0;
}

function validateDecodedGeometry(decoded: DecodedAzgaarCartographySource): void {
  const vertexIds = requireUniqueIds(decoded.vertexIds, 'vertex');
  requireUniqueIds(decoded.cellIds, 'cell');

  if (decoded.vertexOffsets[0] !== 0
      || decoded.vertexOffsets[decoded.vertexOffsets.length - 1] !== decoded.cellVertexIds.length) {
    throw new Error('Azgaar cartography cell vertex offsets do not span the vertex references.');
  }

  for (let cellIndex = 0; cellIndex < decoded.cellIds.length; cellIndex += 1) {
    const start = decoded.vertexOffsets[cellIndex] ?? 0;
    const end = decoded.vertexOffsets[cellIndex + 1] ?? 0;
    if (end < start || end - start < 3) {
      throw new Error(`Azgaar cartography cell ${decoded.cellIds[cellIndex]} has an invalid polygon.`);
    }
  }

  for (const vertexId of decoded.cellVertexIds) {
    if (!vertexIds.has(vertexId)) {
      throw new Error(`Azgaar cartography references missing vertex ${vertexId}.`);
    }
  }

  for (const coordinate of decoded.vertexPoints) {
    if (!Number.isFinite(coordinate)) {
      throw new Error('Azgaar cartography contains a non-finite vertex coordinate.');
    }
  }
  for (const coordinate of decoded.cellCenters) {
    if (!Number.isFinite(coordinate)) {
      throw new Error('Azgaar cartography contains a non-finite cell center.');
    }
  }
}

export function createAzgaarCartographySource(document: unknown): AzgaarCartographySource {
  const root = asRecord(document);
  const info = asRecord(root?.info);
  const pack = asRecord(root?.pack);
  const width = requirePositiveDimension(info?.width, 'source width');
  const height = requirePositiveDimension(info?.height, 'source height');
  const sourceVertices = pack?.vertices;
  const sourceCells = pack?.cells;
  if (!Array.isArray(sourceVertices) || !Array.isArray(sourceCells)
      || sourceVertices.length === 0 || sourceCells.length === 0) {
    throw new Error('Azgaar Full JSON must include pack vertices and cells for vector cartography.');
  }
  requireCount(sourceVertices.length, MAX_VERTEX_COUNT, 'vertex count');
  requireCount(sourceCells.length, MAX_CELL_COUNT, 'cell count');

  const vertexIds = new Uint32Array(sourceVertices.length);
  const vertexPoints = new Float32Array(sourceVertices.length * 2);
  const vertexIdSet = new Set<number>();
  for (let index = 0; index < sourceVertices.length; index += 1) {
    const vertex = asRecord(sourceVertices[index]);
    if (!vertex) throw new Error(`Azgaar cartography vertex ${index} is invalid.`);
    const id = requireId(vertex.i, 'vertex id');
    if (vertexIdSet.has(id)) {
      throw new Error(`Azgaar cartography has duplicate vertex id ${id}.`);
    }
    vertexIdSet.add(id);
    const [x, y] = requirePoint(vertex.p, `vertex ${id}`);
    vertexIds[index] = id;
    vertexPoints[index * 2] = x;
    vertexPoints[index * 2 + 1] = y;
  }

  const cellIds = new Uint32Array(sourceCells.length);
  const cellCenters = new Float32Array(sourceCells.length * 2);
  const vertexOffsets = new Uint32Array(sourceCells.length + 1);
  const heights = new Uint8Array(sourceCells.length);
  const biomes = new Uint8Array(sourceCells.length);
  const features = new Uint32Array(sourceCells.length);
  const states = new Uint32Array(sourceCells.length);
  const provinces = new Uint32Array(sourceCells.length);
  const cultures = new Uint32Array(sourceCells.length);
  const religions = new Uint32Array(sourceCells.length);
  const burgs = new Uint32Array(sourceCells.length);
  const flattenedVertexIds: number[] = [];
  const cellIdSet = new Set<number>();

  for (let index = 0; index < sourceCells.length; index += 1) {
    const cell = asRecord(sourceCells[index]);
    if (!cell) throw new Error(`Azgaar cartography cell ${index} is invalid.`);
    const id = requireId(cell.i, 'cell id');
    if (cellIdSet.has(id)) {
      throw new Error(`Azgaar cartography has duplicate cell id ${id}.`);
    }
    cellIdSet.add(id);
    const [x, y] = requirePoint(cell.p, `cell ${id}`);
    if (!Array.isArray(cell.v) || cell.v.length < 3) {
      throw new Error(`Azgaar cartography cell ${id} must have at least three vertices.`);
    }
    if (flattenedVertexIds.length + cell.v.length > MAX_VERTEX_REFERENCE_COUNT) {
      throw new Error('Azgaar cartography has an invalid vertex reference count.');
    }

    cellIds[index] = id;
    cellCenters[index * 2] = x;
    cellCenters[index * 2 + 1] = y;
    vertexOffsets[index] = flattenedVertexIds.length;
    for (const sourceVertexId of cell.v) {
      const vertexId = requireId(sourceVertexId, `cell ${id} vertex id`);
      if (!vertexIdSet.has(vertexId)) {
        throw new Error(`Azgaar cartography cell ${id} references missing vertex ${vertexId}.`);
      }
      flattenedVertexIds.push(vertexId);
    }

    heights[index] = clamp(Math.round(Number(cell.h ?? 0)), 0, 255);
    biomes[index] = clamp(Math.round(Number(cell.biome ?? 0)), 0, 255);
    features[index] = classificationId(cell, 'f');
    states[index] = classificationId(cell, 'state');
    provinces[index] = classificationId(cell, 'province');
    cultures[index] = classificationId(cell, 'culture');
    religions[index] = classificationId(cell, 'religion');
    burgs[index] = classificationId(cell, 'burg');
  }
  vertexOffsets[sourceCells.length] = flattenedVertexIds.length;

  return {
    kind: CARTOGRAPHY_KIND,
    version: CARTOGRAPHY_VERSION,
    encoding: BINARY_ENCODING,
    width,
    height,
    vertices: {
      count: vertexIds.length,
      ids: encodeNumbers(vertexIds, 'u32'),
      points: encodeNumbers(vertexPoints, 'f32'),
    },
    cells: {
      count: cellIds.length,
      vertexReferenceCount: flattenedVertexIds.length,
      ids: encodeNumbers(cellIds, 'u32'),
      centers: encodeNumbers(cellCenters, 'f32'),
      vertexOffsets: encodeNumbers(vertexOffsets, 'u32'),
      vertexIds: encodeNumbers(flattenedVertexIds, 'u32'),
      heights: encodeNumbers(heights, 'u8'),
      biomes: encodeNumbers(biomes, 'u8'),
      features: encodeNumbers(features, 'u32'),
      states: encodeNumbers(states, 'u32'),
      provinces: encodeNumbers(provinces, 'u32'),
      cultures: encodeNumbers(cultures, 'u32'),
      religions: encodeNumbers(religions, 'u32'),
      burgs: encodeNumbers(burgs, 'u32'),
    },
  };
}

function isEncodedVertices(value: unknown): value is EncodedVertices {
  const record = asRecord(value);
  return record !== null
    && isSafeInteger(record.count)
    && typeof record.ids === 'string'
    && typeof record.points === 'string';
}

function isEncodedCells(value: unknown): value is EncodedCells {
  const record = asRecord(value);
  if (!record || !isSafeInteger(record.count) || !isSafeInteger(record.vertexReferenceCount)) {
    return false;
  }
  const fields = [
    'ids',
    'centers',
    'vertexOffsets',
    'vertexIds',
    'heights',
    'biomes',
    'features',
    'states',
    'provinces',
    'cultures',
    'religions',
    'burgs',
  ];
  return fields.every((field) => typeof record[field] === 'string');
}

export function isAzgaarCartographySource(source: unknown): source is AzgaarCartographySource {
  const record = asRecord(source);
  if (!record) return false;
  return record.kind === CARTOGRAPHY_KIND
    && record.version === CARTOGRAPHY_VERSION
    && record.encoding === BINARY_ENCODING
    && typeof record.width === 'number'
    && typeof record.height === 'number'
    && isEncodedVertices(record.vertices)
    && isEncodedCells(record.cells);
}

export function decodeAzgaarCartographySource(
  source: unknown,
): Readonly<DecodedAzgaarCartographySource> {
  if (!isAzgaarCartographySource(source)) {
    throw new Error('Unsupported Azgaar cartography source.');
  }
  const width = requirePositiveDimension(source.width, 'source width');
  const height = requirePositiveDimension(source.height, 'source height');
  const vertexCount = requireCount(source.vertices.count, MAX_VERTEX_COUNT, 'vertex count');
  const cellCount = requireCount(source.cells.count, MAX_CELL_COUNT, 'cell count');
  const vertexReferenceCount = requireCount(
    source.cells.vertexReferenceCount,
    MAX_VERTEX_REFERENCE_COUNT,
    'vertex reference count',
  );

  const decoded: DecodedAzgaarCartographySource = {
    width,
    height,
    vertexIds: decodeNumbers(source.vertices.ids, vertexCount, 'u32', 'vertex ids'),
    vertexPoints: decodeNumbers(source.vertices.points, vertexCount * 2, 'f32', 'vertex points'),
    cellIds: decodeNumbers(source.cells.ids, cellCount, 'u32', 'cell ids'),
    cellCenters: decodeNumbers(source.cells.centers, cellCount * 2, 'f32', 'cell centers'),
    vertexOffsets: decodeNumbers(
      source.cells.vertexOffsets,
      cellCount + 1,
      'u32',
      'cell vertex offsets',
    ),
    cellVertexIds: decodeNumbers(
      source.cells.vertexIds,
      vertexReferenceCount,
      'u32',
      'cell vertex ids',
    ),
    heights: decodeNumbers(source.cells.heights, cellCount, 'u8', 'cell heights'),
    biomes: decodeNumbers(source.cells.biomes, cellCount, 'u8', 'cell biomes'),
    features: decodeNumbers(source.cells.features, cellCount, 'u32', 'cell features'),
    states: decodeNumbers(source.cells.states, cellCount, 'u32', 'cell states'),
    provinces: decodeNumbers(source.cells.provinces, cellCount, 'u32', 'cell provinces'),
    cultures: decodeNumbers(source.cells.cultures, cellCount, 'u32', 'cell cultures'),
    religions: decodeNumbers(source.cells.religions, cellCount, 'u32', 'cell religions'),
    burgs: decodeNumbers(source.cells.burgs, cellCount, 'u32', 'cell burgs'),
  };
  validateDecodedGeometry(decoded);
  return Object.freeze(decoded);
}

export const AZGAAR_CARTOGRAPHY_KIND = CARTOGRAPHY_KIND;
export const AZGAAR_CARTOGRAPHY_ENCODING = BINARY_ENCODING;
