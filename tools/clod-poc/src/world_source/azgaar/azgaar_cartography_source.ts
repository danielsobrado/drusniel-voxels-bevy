// @ts-nocheck
const CARTOGRAPHY_KIND = 'azgaar-cartography-v1';
const CARTOGRAPHY_VERSION = 1;
const BINARY_ENCODING = 'base64-le-v1';
const MAX_VERTEX_COUNT = 2_000_000;
const MAX_CELL_COUNT = 1_000_000;
const MAX_VERTEX_REFERENCE_COUNT = 12_000_000;

const NUMBER_FORMATS = Object.freeze({
  u8: Object.freeze({
    bytes: 1,
    read: (view, offset) => view.getUint8(offset),
    write: (view, offset, value) => view.setUint8(offset, value),
  }),
  u32: Object.freeze({
    bytes: 4,
    read: (view, offset) => view.getUint32(offset, true),
    write: (view, offset, value) => view.setUint32(offset, value, true),
  }),
  f32: Object.freeze({
    bytes: 4,
    read: (view, offset) => view.getFloat32(offset, true),
    write: (view, offset, value) => view.setFloat32(offset, value, true),
  }),
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function bytesToBase64(bytes) {
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

function base64ToBytes(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`Azgaar cartography ${label} must be a base64 string.`);
  }
  try {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(value, 'base64'));
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error(`Azgaar cartography ${label} is not valid base64.`);
  }
}

function encodeNumbers(values, formatName) {
  const format = NUMBER_FORMATS[formatName];
  const bytes = new Uint8Array(values.length * format.bytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    format.write(view, index * format.bytes, values[index]);
  }
  return bytesToBase64(bytes);
}

function decodeNumbers(encoded, count, formatName, label) {
  const format = NUMBER_FORMATS[formatName];
  const bytes = base64ToBytes(encoded, label);
  const expectedBytes = count * format.bytes;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `Azgaar cartography ${label} has ${bytes.byteLength} bytes; expected ${expectedBytes}.`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const Result = formatName === 'u8'
    ? Uint8Array
    : formatName === 'u32'
      ? Uint32Array
      : Float32Array;
  const result = new Result(count);
  for (let index = 0; index < count; index += 1) {
    result[index] = format.read(view, index * format.bytes);
  }
  return result;
}

function requirePositiveDimension(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Azgaar cartography requires a positive ${label}.`);
  }
  return numeric;
}

function requireCount(value, maximum, label) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > maximum) {
    throw new Error(`Azgaar cartography has an invalid ${label}.`);
  }
  return numeric;
}

function requireId(value, label) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    throw new Error(`Azgaar cartography ${label} must be an unsigned 32-bit integer.`);
  }
  return numeric;
}

function requirePoint(value, label) {
  if (!Array.isArray(value) || value.length < 2
      || !Number.isFinite(Number(value[0])) || !Number.isFinite(Number(value[1]))) {
    throw new Error(`Azgaar cartography ${label} must contain finite x/y coordinates.`);
  }
  return [Number(value[0]), Number(value[1])];
}

function requireUniqueIds(ids, label) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Azgaar cartography has duplicate ${label} id ${id}.`);
    }
    seen.add(id);
  }
  return seen;
}

function classificationId(cell, key) {
  const numeric = Number(cell?.[key] ?? 0);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff ? numeric : 0;
}

function validateDecodedGeometry(decoded) {
  const vertexIds = requireUniqueIds(decoded.vertexIds, 'vertex');
  requireUniqueIds(decoded.cellIds, 'cell');

  if (decoded.vertexOffsets[0] !== 0
      || decoded.vertexOffsets[decoded.vertexOffsets.length - 1] !== decoded.cellVertexIds.length) {
    throw new Error('Azgaar cartography cell vertex offsets do not span the vertex references.');
  }

  for (let cellIndex = 0; cellIndex < decoded.cellIds.length; cellIndex += 1) {
    const start = decoded.vertexOffsets[cellIndex];
    const end = decoded.vertexOffsets[cellIndex + 1];
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

export function createAzgaarCartographySource(document) {
  const width = requirePositiveDimension(document?.info?.width, 'source width');
  const height = requirePositiveDimension(document?.info?.height, 'source height');
  const sourceVertices = document?.pack?.vertices;
  const sourceCells = document?.pack?.cells;
  if (!Array.isArray(sourceVertices) || !Array.isArray(sourceCells)
      || sourceVertices.length === 0 || sourceCells.length === 0) {
    throw new Error('Azgaar Full JSON must include pack vertices and cells for vector cartography.');
  }
  requireCount(sourceVertices.length, MAX_VERTEX_COUNT, 'vertex count');
  requireCount(sourceCells.length, MAX_CELL_COUNT, 'cell count');

  const vertexIds = new Uint32Array(sourceVertices.length);
  const vertexPoints = new Float32Array(sourceVertices.length * 2);
  const vertexIdSet = new Set();
  for (let index = 0; index < sourceVertices.length; index += 1) {
    const vertex = sourceVertices[index];
    const id = requireId(vertex?.i, 'vertex id');
    if (vertexIdSet.has(id)) {
      throw new Error(`Azgaar cartography has duplicate vertex id ${id}.`);
    }
    vertexIdSet.add(id);
    const [x, y] = requirePoint(vertex?.p, `vertex ${id}`);
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
  const flattenedVertexIds = [];
  const cellIdSet = new Set();

  for (let index = 0; index < sourceCells.length; index += 1) {
    const cell = sourceCells[index];
    const id = requireId(cell?.i, 'cell id');
    if (cellIdSet.has(id)) {
      throw new Error(`Azgaar cartography has duplicate cell id ${id}.`);
    }
    cellIdSet.add(id);
    const [x, y] = requirePoint(cell?.p, `cell ${id}`);
    if (!Array.isArray(cell?.v) || cell.v.length < 3) {
      throw new Error(`Azgaar cartography cell ${id} must have at least three vertices.`);
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
  requireCount(flattenedVertexIds.length, MAX_VERTEX_REFERENCE_COUNT, 'vertex reference count');

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

export function isAzgaarCartographySource(source) {
  return source?.kind === CARTOGRAPHY_KIND
    && source?.version === CARTOGRAPHY_VERSION
    && source?.encoding === BINARY_ENCODING;
}

export function decodeAzgaarCartographySource(source) {
  if (!isAzgaarCartographySource(source)) {
    throw new Error('Unsupported Azgaar cartography source.');
  }
  const width = requirePositiveDimension(source.width, 'source width');
  const height = requirePositiveDimension(source.height, 'source height');
  const vertexCount = requireCount(source.vertices?.count, MAX_VERTEX_COUNT, 'vertex count');
  const cellCount = requireCount(source.cells?.count, MAX_CELL_COUNT, 'cell count');
  const vertexReferenceCount = requireCount(
    source.cells?.vertexReferenceCount,
    MAX_VERTEX_REFERENCE_COUNT,
    'vertex reference count',
  );

  const decoded = {
    width,
    height,
    vertexIds: decodeNumbers(source.vertices?.ids, vertexCount, 'u32', 'vertex ids'),
    vertexPoints: decodeNumbers(
      source.vertices?.points,
      vertexCount * 2,
      'f32',
      'vertex points',
    ),
    cellIds: decodeNumbers(source.cells?.ids, cellCount, 'u32', 'cell ids'),
    cellCenters: decodeNumbers(source.cells?.centers, cellCount * 2, 'f32', 'cell centers'),
    vertexOffsets: decodeNumbers(
      source.cells?.vertexOffsets,
      cellCount + 1,
      'u32',
      'cell vertex offsets',
    ),
    cellVertexIds: decodeNumbers(
      source.cells?.vertexIds,
      vertexReferenceCount,
      'u32',
      'cell vertex ids',
    ),
    heights: decodeNumbers(source.cells?.heights, cellCount, 'u8', 'cell heights'),
    biomes: decodeNumbers(source.cells?.biomes, cellCount, 'u8', 'cell biomes'),
    features: decodeNumbers(source.cells?.features, cellCount, 'u32', 'cell features'),
    states: decodeNumbers(source.cells?.states, cellCount, 'u32', 'cell states'),
    provinces: decodeNumbers(source.cells?.provinces, cellCount, 'u32', 'cell provinces'),
    cultures: decodeNumbers(source.cells?.cultures, cellCount, 'u32', 'cell cultures'),
    religions: decodeNumbers(source.cells?.religions, cellCount, 'u32', 'cell religions'),
    burgs: decodeNumbers(source.cells?.burgs, cellCount, 'u32', 'cell burgs'),
  };
  validateDecodedGeometry(decoded);
  return Object.freeze(decoded);
}

export const AZGAAR_CARTOGRAPHY_KIND = CARTOGRAPHY_KIND;
export const AZGAAR_CARTOGRAPHY_ENCODING = BINARY_ENCODING;
