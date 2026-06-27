import type { PageFootprint } from "../types.js";
import { CACHE_MAGIC, CACHE_SECTION } from "./cacheTypes.js";
import { CacheCorruptError, CacheDecodeError } from "./cacheErrors.js";

export interface ClodPageNodeArtifact {
  nodeId: string;
  level: number;
  positions: Float32Array;
  normals: Float32Array;
  paintSlots: Float32Array;
  materialWeights: Float32Array;
  materialWeightStride: number;
  indices: Uint32Array;
  errorWorld: number;
  boundingSphere: [number, number, number, number];
  lowBenefit: boolean;
  footprint: PageFootprint;
  bounds: { center: [number, number, number]; radius: number; minY: number; maxY: number };
}

export interface ClodPageTreeArtifact {
  worldPagesX: number;
  worldPagesZ: number;
  levels: number;
  nodes: Array<{ id: string; level: number; childIds: (string | null)[] }>;
}

export interface TerrainSummaryArtifact {
  res: number;
  worldSize: number;
  farReduceFactor: number;
  heightMin: Float32Array;
  heightMax: Float32Array;
  normalX: Float32Array;
  normalY: Float32Array;
  normalZ: Float32Array;
  coverage: Float32Array;
}

const MAGIC_BYTES = new TextEncoder().encode(CACHE_MAGIC);

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

interface SectionSpec {
  type: number;
  bytes: ArrayBuffer;
}

function buildContainer(sections: SectionSpec[]): ArrayBuffer {
  const headerSize = 8 + sections.length * 12;
  let dataOffset = headerSize;
  const dataParts: Uint8Array[] = [];
  const header = new ArrayBuffer(headerSize);
  const view = new DataView(header);
  new Uint8Array(header).set(MAGIC_BYTES, 0);
  writeU32(view, 4, sections.length);

  sections.forEach((section, i) => {
    const base = 8 + i * 12;
    writeU32(view, base, section.type);
    writeU32(view, base + 4, section.bytes.byteLength);
    writeU32(view, base + 8, dataOffset);
    dataParts.push(new Uint8Array(section.bytes));
    dataOffset += section.bytes.byteLength;
  });

  const total = dataOffset;
  const out = new Uint8Array(total);
  out.set(new Uint8Array(header), 0);
  let offset = headerSize;
  for (const part of dataParts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

function parseContainer(bytes: ArrayBuffer): Map<number, ArrayBuffer> {
  if (bytes.byteLength < 8) throw new CacheCorruptError("payload too small");
  const view = new DataView(bytes);
  const magic = new Uint8Array(bytes, 0, 4);
  for (let i = 0; i < 4; i++) {
    if (magic[i] !== MAGIC_BYTES[i]) throw new CacheCorruptError("invalid cache payload magic");
  }
  const sectionCount = readU32(view, 4);
  const headerSize = 8 + sectionCount * 12;
  if (headerSize > bytes.byteLength) throw new CacheCorruptError("section table exceeds payload bounds");
  const sections = new Map<number, ArrayBuffer>();
  const ranges: Array<{ start: number; end: number; type: number }> = [];
  for (let i = 0; i < sectionCount; i++) {
    const base = 8 + i * 12;
    const type = readU32(view, base);
    const length = readU32(view, base + 4);
    const offset = readU32(view, base + 8);
    if (sections.has(type)) throw new CacheCorruptError(`duplicate section ${type}`);
    if (offset < headerSize) throw new CacheCorruptError(`section ${type} overlaps header`);
    if (offset + length > bytes.byteLength) {
      throw new CacheCorruptError(`section ${type} exceeds payload bounds`);
    }
    for (const range of ranges) {
      const overlaps = offset < range.end && offset + length > range.start;
      if (overlaps) throw new CacheCorruptError(`section ${type} overlaps section ${range.type}`);
    }
    ranges.push({ start: offset, end: offset + length, type });
    sections.set(type, bytes.slice(offset, offset + length));
  }
  return sections;
}

function sliceBuffer(data: Float32Array | Uint32Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function typedF32Section(type: number, data: Float32Array): SectionSpec {
  return { type, bytes: sliceBuffer(data) };
}

function jsonSection(type: number, value: unknown): SectionSpec {
  const json = JSON.stringify(value);
  return { type, bytes: new TextEncoder().encode(json).buffer };
}

function readF32Section(sections: Map<number, ArrayBuffer>, type: number, label: string): Float32Array {
  const buf = sections.get(type);
  if (!buf) throw new CacheDecodeError(`missing required section ${label}`);
  if (buf.byteLength % 4 !== 0) throw new CacheDecodeError(`invalid f32 section length for ${label}`);
  return new Float32Array(buf);
}

function readU32Section(sections: Map<number, ArrayBuffer>): Uint32Array {
  const buf = sections.get(CACHE_SECTION.INDICES_U32);
  if (!buf) throw new CacheDecodeError("missing indices section");
  if (buf.byteLength % 4 !== 0) throw new CacheDecodeError("invalid u32 section length");
  return new Uint32Array(buf);
}

function readJsonSection<T>(sections: Map<number, ArrayBuffer>, type: number, label: string): T {
  const buf = sections.get(type);
  if (!buf) throw new CacheDecodeError(`missing required section ${label}`);
  const text = new TextDecoder().decode(buf);
  return JSON.parse(text) as T;
}

function validateNodeArtifact(artifact: ClodPageNodeArtifact): void {
  if (artifact.positions.length % 3 !== 0) {
    throw new CacheDecodeError("node positions length must be divisible by 3");
  }
  const vertexCount = artifact.positions.length / 3;
  if (artifact.normals.length !== artifact.positions.length) {
    throw new CacheDecodeError("node normals length must match positions length");
  }
  if (artifact.paintSlots.length !== vertexCount) {
    throw new CacheDecodeError("node paintSlots length must match vertex count");
  }
  if (!Number.isInteger(artifact.materialWeightStride) || artifact.materialWeightStride <= 0) {
    throw new CacheDecodeError("node materialWeightStride must be a positive integer");
  }
  if (artifact.materialWeights.length !== vertexCount * artifact.materialWeightStride) {
    throw new CacheDecodeError("node materialWeights length must match vertex count and stride");
  }
  if (artifact.indices.length % 3 !== 0) {
    throw new CacheDecodeError("node indices length must be divisible by 3");
  }
}

function validateSummaryArtifact(artifact: TerrainSummaryArtifact): void {
  if (!Number.isInteger(artifact.res) || artifact.res <= 0) {
    throw new CacheDecodeError("summary res must be a positive integer");
  }
  const expected = artifact.res * artifact.res;
  const channels: Array<[string, Float32Array]> = [
    ["heightMin", artifact.heightMin],
    ["heightMax", artifact.heightMax],
    ["normalX", artifact.normalX],
    ["normalY", artifact.normalY],
    ["normalZ", artifact.normalZ],
    ["coverage", artifact.coverage],
  ];
  for (const [label, channel] of channels) {
    if (channel.length !== expected) {
      throw new CacheDecodeError(`summary ${label} length must equal res*res`);
    }
  }
}

export function encodeClodPageNodeArtifact(artifact: ClodPageNodeArtifact): ArrayBuffer {
  validateNodeArtifact(artifact);
  const metadata = {
    nodeId: artifact.nodeId,
    level: artifact.level,
    errorWorld: artifact.errorWorld,
    boundingSphere: artifact.boundingSphere,
    lowBenefit: artifact.lowBenefit,
    materialWeightStride: artifact.materialWeightStride,
    footprint: artifact.footprint,
    bounds: artifact.bounds,
  };
  return buildContainer([
    typedF32Section(CACHE_SECTION.POSITIONS_F32, artifact.positions),
    typedF32Section(CACHE_SECTION.NORMALS_F32, artifact.normals),
    typedF32Section(CACHE_SECTION.MATERIAL_WEIGHTS_F32, artifact.materialWeights),
    { type: CACHE_SECTION.INDICES_U32, bytes: sliceBuffer(artifact.indices) },
    typedF32Section(CACHE_SECTION.PAINT_SLOTS_F32, artifact.paintSlots),
    jsonSection(CACHE_SECTION.NODE_METADATA_JSON, metadata),
  ]);
}

export function decodeClodPageNodeArtifact(bytes: ArrayBuffer): ClodPageNodeArtifact {
  const sections = parseContainer(bytes);
  const meta = readJsonSection<{
    nodeId: string;
    level: number;
    errorWorld: number;
    boundingSphere: [number, number, number, number];
    lowBenefit: boolean;
    materialWeightStride: number;
    footprint: PageFootprint;
    bounds: ClodPageNodeArtifact["bounds"];
  }>(sections, CACHE_SECTION.NODE_METADATA_JSON, "node metadata");

  const artifact: ClodPageNodeArtifact = {
    nodeId: meta.nodeId,
    level: meta.level,
    positions: readF32Section(sections, CACHE_SECTION.POSITIONS_F32, "positions"),
    normals: readF32Section(sections, CACHE_SECTION.NORMALS_F32, "normals"),
    materialWeights: readF32Section(sections, CACHE_SECTION.MATERIAL_WEIGHTS_F32, "materialWeights"),
    paintSlots: readF32Section(sections, CACHE_SECTION.PAINT_SLOTS_F32, "paintSlots"),
    materialWeightStride: meta.materialWeightStride,
    indices: readU32Section(sections),
    errorWorld: meta.errorWorld,
    boundingSphere: meta.boundingSphere,
    lowBenefit: meta.lowBenefit,
    footprint: meta.footprint,
    bounds: meta.bounds,
  };
  validateNodeArtifact(artifact);
  return artifact;
}

export function encodeClodPageTreeArtifact(artifact: ClodPageTreeArtifact): ArrayBuffer {
  return buildContainer([jsonSection(CACHE_SECTION.TREE_METADATA_JSON, artifact)]);
}

export function decodeClodPageTreeArtifact(bytes: ArrayBuffer): ClodPageTreeArtifact {
  const sections = parseContainer(bytes);
  return readJsonSection<ClodPageTreeArtifact>(sections, CACHE_SECTION.TREE_METADATA_JSON, "tree metadata");
}

export function encodeTerrainSummaryArtifact(artifact: TerrainSummaryArtifact): ArrayBuffer {
  validateSummaryArtifact(artifact);
  const f32Data = concatSummaryF32(artifact);
  const metadata = {
    res: artifact.res,
    worldSize: artifact.worldSize,
    farReduceFactor: artifact.farReduceFactor,
    channelLengths: {
      heightMin: artifact.heightMin.length,
      heightMax: artifact.heightMax.length,
      normalX: artifact.normalX.length,
      normalY: artifact.normalY.length,
      normalZ: artifact.normalZ.length,
      coverage: artifact.coverage.length,
    },
  };
  return buildContainer([
    { type: CACHE_SECTION.SUMMARY_F32, bytes: f32Data },
    jsonSection(CACHE_SECTION.NODE_METADATA_JSON, metadata),
  ]);
}

function checkedChannelLength(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new CacheDecodeError(`invalid summary channel length for ${label}`);
  }
  return value as number;
}

export function decodeTerrainSummaryArtifact(bytes: ArrayBuffer): TerrainSummaryArtifact {
  const sections = parseContainer(bytes);
  const meta = readJsonSection<{
    res: number;
    worldSize: number;
    farReduceFactor: number;
    channelLengths: Record<string, number>;
  }>(sections, CACHE_SECTION.NODE_METADATA_JSON, "summary metadata");
  const f32Buf = sections.get(CACHE_SECTION.SUMMARY_F32);
  if (!f32Buf) throw new CacheDecodeError("missing summary f32 section");
  if (f32Buf.byteLength % 4 !== 0) throw new CacheDecodeError("invalid summary f32 section length");
  const all = new Float32Array(f32Buf);
  const cl = meta.channelLengths;
  const lengths = {
    heightMin: checkedChannelLength(cl.heightMin, "heightMin"),
    heightMax: checkedChannelLength(cl.heightMax, "heightMax"),
    normalX: checkedChannelLength(cl.normalX, "normalX"),
    normalY: checkedChannelLength(cl.normalY, "normalY"),
    normalZ: checkedChannelLength(cl.normalZ, "normalZ"),
    coverage: checkedChannelLength(cl.coverage, "coverage"),
  };
  const expected = lengths.heightMin + lengths.heightMax + lengths.normalX + lengths.normalY + lengths.normalZ + lengths.coverage;
  if (expected !== all.length) {
    throw new CacheDecodeError(`summary channel length mismatch: expected ${expected}, got ${all.length}`);
  }

  let offset = 0;
  const take = (len: number) => {
    const slice = all.slice(offset, offset + len);
    offset += len;
    return slice;
  };
  const artifact = {
    res: meta.res,
    worldSize: meta.worldSize,
    farReduceFactor: meta.farReduceFactor,
    heightMin: take(lengths.heightMin),
    heightMax: take(lengths.heightMax),
    normalX: take(lengths.normalX),
    normalY: take(lengths.normalY),
    normalZ: take(lengths.normalZ),
    coverage: take(lengths.coverage),
  };
  validateSummaryArtifact(artifact);
  return artifact;
}

function concatSummaryF32(artifact: TerrainSummaryArtifact): ArrayBuffer {
  const total =
    artifact.heightMin.length +
    artifact.heightMax.length +
    artifact.normalX.length +
    artifact.normalY.length +
    artifact.normalZ.length +
    artifact.coverage.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const arr of [
    artifact.heightMin,
    artifact.heightMax,
    artifact.normalX,
    artifact.normalY,
    artifact.normalZ,
    artifact.coverage,
  ]) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out.buffer;
}

// re-export section builder helper for tests
export { buildContainer, parseContainer };
