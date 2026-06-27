import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DEFAULT_ASSET_ROOT = resolve(REPO_ROOT, "public/assets/construction/quaternius/rpg_items/models");
const DEFAULT_CATALOG_PATH = join(DEFAULT_ASSET_ROOT, "construction-props.catalog.json");
const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const SKIP_DIRS = new Set(["fbx", "obj", "blends", "textures", "universal animation library[standard]"]);
const PLANE_NORMAL_DOT = 0.92;
const SIDE_Y_ABS_MAX = 0.22;
const ROOF_Y_MIN = 0.25;
const ROOF_Y_MAX = 0.92;
const MIN_PLANE_AREA_RATIO = 0.015;
const MIN_PLANE_AREA_ABS = 0.02;
const DECIMALS = 4;

type SnapGroup = "prop-bottom" | "prop-top" | "prop-side" | "prop-door" | "prop-window" | "prop-roof" | "prop-foundation";
type AccessorType = "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";

interface CatalogFile {
  schemaVersion: 1;
  packId: string;
  generatedAt: string;
  props: CatalogEntry[];
}

interface CatalogEntry {
  id: string;
  source: string;
  category?: string;
  pivot?: string;
  snap_points?: SnapPoint[];
  snapPoints?: SnapPoint[];
  [key: string]: unknown;
}

interface SnapPoint {
  id: string;
  local_pos: [number, number, number];
  direction: [number, number, number];
  group: SnapGroup;
  accepts: SnapGroup[];
  generated?: true;
  confidence?: number;
  source?: string;
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  name?: string;
}

interface GltfDocument {
  buffers?: Array<{ uri?: string; byteLength: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: AccessorType; normalized?: boolean }>;
  meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number>; indices?: number; mode?: number; material?: number }> }>;
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  materials?: Array<{ name?: string }>;
}

interface LoadedGltf {
  document: GltfDocument;
  baseDir: string;
  binaryChunk: Buffer | null;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface TriangleSample {
  centroid: Vec3;
  normal: Vec3;
  area: number;
  label: string;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
}

interface PlaneAccumulator {
  id: string;
  group: SnapGroup;
  direction: Vec3;
  weightedCentroid: Vec3;
  area: number;
  sampleCount: number;
  source: string;
}

interface CliOptions {
  assetRoot: string;
  catalogPath: string;
  overwriteAuthored: boolean;
  dryRun: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    assetRoot: DEFAULT_ASSET_ROOT,
    catalogPath: DEFAULT_CATALOG_PATH,
    overwriteAuthored: false,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--root") options.assetRoot = resolve(args[++i] ?? options.assetRoot);
    else if (arg === "--catalog") options.catalogPath = resolve(args[++i] ?? options.catalogPath);
    else if (arg === "--overwrite-authored") options.overwriteAuthored = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help") {
      console.log("Usage: tsx tools/generate-prop-snaps.ts [--root <asset-root>] [--catalog <catalog.json>] [--overwrite-authored] [--dry-run]");
      process.exit(0);
    }
  }
  return options;
}

function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mul(a: Vec3, scalar: number): Vec3 {
  return vec(a.x * scalar, a.y * scalar, a.z * scalar);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0.000001 ? mul(a, 1 / len) : vec(0, 1, 0);
}

function round(value: number): number {
  const scale = 10 ** DECIMALS;
  return Math.round(value * scale) / scale;
}

function tuple(value: Vec3): [number, number, number] {
  return [round(value.x), round(value.y), round(value.z)];
}

function mat4Identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let k = 0; k < 4; k += 1) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function mat4FromTrs(translation?: number[], rotation?: number[], scale?: number[]): number[] {
  const t = translation ?? [0, 0, 0];
  const r = rotation ?? [0, 0, 0, 1];
  const s = scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

function transformPoint(m: number[], p: Vec3): Vec3 {
  return vec(
    m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  );
}

function readCatalog(path: string): CatalogFile {
  if (!existsSync(path)) return { schemaVersion: 1, packId: "quaternius-construction", generatedAt: "generated", props: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CatalogFile>;
  return {
    schemaVersion: 1,
    packId: parsed.packId ?? "quaternius-construction",
    generatedAt: String(parsed.generatedAt ?? "generated"),
    props: Array.isArray(parsed.props) ? parsed.props : [],
  };
}

function writeCatalog(path: string, catalog: CatalogFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function walkModels(root: string, out: string[]): void {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name.toLowerCase())) walkModels(full, out);
      continue;
    }
    if (stat.isFile() && MODEL_EXTENSIONS.has(extname(name).toLowerCase())) out.push(full);
  }
}

function sourceFromPath(assetRoot: string, filePath: string): string {
  return relative(assetRoot, filePath).split(sep).join("/");
}

function safeId(source: string): string {
  return source
    .replace(/\.[^.]+$/, "")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function categoryFor(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes("tree") || lower.includes("bush") || lower.includes("plant")) return "vegetation";
  if (lower.includes("door") || lower.includes("gate") || lower.includes("chest")) return "interactive";
  if (lower.includes("house") || lower.includes("tower") || lower.includes("wall") || lower.includes("bridge")) return "large_static";
  if (lower.includes("barrel") || lower.includes("crate") || lower.includes("cart") || lower.includes("stall")) return "medium_static";
  return "small_decor";
}

function ensureCatalogEntries(catalog: CatalogFile, assetRoot: string): void {
  if (catalog.props.length > 0 || !existsSync(assetRoot)) return;
  const files: string[] = [];
  walkModels(assetRoot, files);
  catalog.props = files.sort((a, b) => a.localeCompare(b)).map((file) => {
    const source = sourceFromPath(assetRoot, file);
    return { id: safeId(source), source, category: categoryFor(source), pivot: "bottom_center" };
  });
}

function parseDataUri(uri: string): Buffer | null {
  const match = uri.match(/^data:.*?;base64,(.+)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

function readGlb(filePath: string): LoadedGltf {
  const data = readFileSync(filePath);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("Invalid GLB magic");
  let offset = 12;
  let json: GltfDocument | null = null;
  let bin: Buffer | null = null;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8")) as GltfDocument;
    if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { document: json, baseDir: dirname(filePath), binaryChunk: bin };
}

function readGltf(filePath: string): LoadedGltf {
  const document = JSON.parse(readFileSync(filePath, "utf8")) as GltfDocument;
  return { document, baseDir: dirname(filePath), binaryChunk: null };
}

function loadGltf(filePath: string): LoadedGltf {
  return extname(filePath).toLowerCase() === ".glb" ? readGlb(filePath) : readGltf(filePath);
}

function bufferData(model: LoadedGltf, index: number): Buffer {
  const buffer = model.document.buffers?.[index];
  if (!buffer) throw new Error(`Missing buffer ${index}`);
  if (!buffer.uri) {
    if (!model.binaryChunk) throw new Error(`Missing binary GLB chunk for buffer ${index}`);
    return model.binaryChunk;
  }
  const data = parseDataUri(buffer.uri);
  if (data) return data;
  return readFileSync(resolve(model.baseDir, buffer.uri));
}

function componentCount(type: AccessorType): number {
  if (type === "SCALAR") return 1;
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  if (type === "VEC4") return 4;
  if (type === "MAT4") return 16;
  return 1;
}

function componentByteSize(componentType: number): number {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  throw new Error(`Unsupported component type ${componentType}`);
}

function readComponent(data: Buffer, offset: number, componentType: number, normalized: boolean): number {
  if (componentType === 5120) {
    const value = data.readInt8(offset);
    return normalized ? Math.max(value / 127, -1) : value;
  }
  if (componentType === 5121) {
    const value = data.readUInt8(offset);
    return normalized ? value / 255 : value;
  }
  if (componentType === 5122) {
    const value = data.readInt16LE(offset);
    return normalized ? Math.max(value / 32767, -1) : value;
  }
  if (componentType === 5123) {
    const value = data.readUInt16LE(offset);
    return normalized ? value / 65535 : value;
  }
  if (componentType === 5125) return data.readUInt32LE(offset);
  if (componentType === 5126) return data.readFloatLE(offset);
  throw new Error(`Unsupported component type ${componentType}`);
}

function readAccessor(model: LoadedGltf, accessorIndex: number): number[][] {
  const accessor = model.document.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`);
  if (accessor.bufferView === undefined) return [];
  const view = model.document.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`Missing bufferView ${accessor.bufferView}`);
  const data = bufferData(model, view.buffer);
  const count = componentCount(accessor.type);
  const componentSize = componentByteSize(accessor.componentType);
  const stride = view.byteStride ?? count * componentSize;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row: number[] = [];
    const rowOffset = base + i * stride;
    for (let c = 0; c < count; c += 1) row.push(readComponent(data, rowOffset + c * componentSize, accessor.componentType, accessor.normalized ?? false));
    rows.push(row);
  }
  return rows;
}

function nodeMatrix(node: GltfNode): number[] {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return [...node.matrix];
  return mat4FromTrs(node.translation, node.rotation, node.scale);
}

function collectSamples(model: LoadedGltf): { samples: TriangleSample[]; bounds: Bounds } {
  const document = model.document;
  const samples: TriangleSample[] = [];
  const bounds: Bounds = { min: vec(Infinity, Infinity, Infinity), max: vec(-Infinity, -Infinity, -Infinity), center: vec() };

  function visitNode(nodeIndex: number, parentMatrix: number[], labelPath: string): void {
    const node = document.nodes?.[nodeIndex];
    if (!node) return;
    const matrix = mat4Multiply(parentMatrix, nodeMatrix(node));
    const label = `${labelPath}/${node.name ?? `node-${nodeIndex}`}`;
    if (node.mesh !== undefined) readMesh(node.mesh, matrix, label);
    for (const child of node.children ?? []) visitNode(child, matrix, label);
  }

  function readMesh(meshIndex: number, matrix: number[], label: string): void {
    const mesh = document.meshes?.[meshIndex];
    if (!mesh) return;
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) continue;
      const positions = readAccessor(model, positionAccessor).map((row) => transformPoint(matrix, vec(row[0], row[1], row[2])));
      for (const position of positions) {
        bounds.min.x = Math.min(bounds.min.x, position.x);
        bounds.min.y = Math.min(bounds.min.y, position.y);
        bounds.min.z = Math.min(bounds.min.z, position.z);
        bounds.max.x = Math.max(bounds.max.x, position.x);
        bounds.max.y = Math.max(bounds.max.y, position.y);
        bounds.max.z = Math.max(bounds.max.z, position.z);
      }
      const indices = primitive.indices !== undefined ? readAccessor(model, primitive.indices).map((row) => row[0]) : positions.map((_, index) => index);
      const materialName = primitive.material !== undefined ? document.materials?.[primitive.material]?.name ?? "" : "";
      const sampleLabel = `${label}/${materialName}`.toLowerCase();
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const a = positions[indices[i]!];
        const b = positions[indices[i + 1]!];
        const c = positions[indices[i + 2]!];
        if (!a || !b || !c) continue;
        const normalRaw = cross(sub(b, a), sub(c, a));
        const area = length(normalRaw) * 0.5;
        if (area <= 0.000001) continue;
        samples.push({ centroid: mul(add(add(a, b), c), 1 / 3), normal: normalize(normalRaw), area, label: sampleLabel });
      }
    }
  }

  const scene = document.scenes?.[document.scene ?? 0] ?? document.scenes?.[0];
  for (const node of scene?.nodes ?? document.nodes?.map((_, index) => index) ?? []) visitNode(node, mat4Identity(), "");
  bounds.center = mul(add(bounds.min, bounds.max), 0.5);
  return { samples, bounds };
}

function directionKey(direction: Vec3): string {
  if (Math.abs(direction.x) >= Math.abs(direction.z)) return direction.x >= 0 ? "east" : "west";
  return direction.z >= 0 ? "south" : "north";
}

function cardinalDirection(normal: Vec3): Vec3 {
  const key = directionKey(normal);
  if (key === "east") return vec(1, 0, 0);
  if (key === "west") return vec(-1, 0, 0);
  if (key === "south") return vec(0, 0, 1);
  return vec(0, 0, -1);
}

function planeBucket(sample: TriangleSample): { id: string; group: SnapGroup; direction: Vec3; source: string } | null {
  const n = sample.normal;
  if (n.y > PLANE_NORMAL_DOT) return { id: "top", group: "prop-top", direction: vec(0, 1, 0), source: "mesh-plane" };
  if (n.y < -PLANE_NORMAL_DOT) return { id: "bottom", group: "prop-bottom", direction: vec(0, -1, 0), source: "mesh-plane" };
  if (Math.abs(n.y) <= SIDE_Y_ABS_MAX) {
    const direction = cardinalDirection(n);
    return { id: `side-${directionKey(direction)}`, group: "prop-side", direction, source: "mesh-plane" };
  }
  if (n.y >= ROOF_Y_MIN && n.y <= ROOF_Y_MAX && sample.label.includes("roof")) return { id: `roof-${directionKey(n)}`, group: "prop-roof", direction: normalize(n), source: "mesh-name-hint" };
  return null;
}

function addPlane(accumulators: Map<string, PlaneAccumulator>, bucket: ReturnType<typeof planeBucket>, sample: TriangleSample): void {
  if (!bucket) return;
  const key = bucket.id;
  const existing = accumulators.get(key) ?? { id: key, group: bucket.group, direction: bucket.direction, weightedCentroid: vec(), area: 0, sampleCount: 0, source: bucket.source };
  existing.weightedCentroid = add(existing.weightedCentroid, mul(sample.centroid, sample.area));
  existing.area += sample.area;
  existing.sampleCount += 1;
  accumulators.set(key, existing);
}

function acceptsFor(group: SnapGroup): SnapGroup[] {
  if (group === "prop-bottom") return ["prop-top", "prop-foundation", "prop-roof"];
  if (group === "prop-top") return ["prop-bottom", "prop-foundation", "prop-roof"];
  if (group === "prop-side") return ["prop-side", "prop-door", "prop-window"];
  if (group === "prop-roof") return ["prop-bottom", "prop-top", "prop-roof"];
  if (group === "prop-foundation") return ["prop-bottom", "prop-top"];
  return ["prop-side"];
}

function snapFromAccumulator(acc: PlaneAccumulator, totalArea: number): SnapPoint {
  const centroid = mul(acc.weightedCentroid, 1 / Math.max(0.000001, acc.area));
  return {
    id: `auto-${acc.id}`,
    local_pos: tuple(centroid),
    direction: tuple(normalize(acc.direction)),
    group: acc.group,
    accepts: acceptsFor(acc.group),
    generated: true,
    confidence: round(Math.min(1, acc.area / Math.max(MIN_PLANE_AREA_ABS, totalArea * MIN_PLANE_AREA_RATIO * 6))),
    source: acc.source,
  };
}

function boundsFallback(bounds: Bounds): SnapPoint[] {
  const min = bounds.min;
  const max = bounds.max;
  const c = bounds.center;
  return [
    { id: "auto-bottom", local_pos: tuple(vec(c.x, min.y, c.z)), direction: [0, -1, 0], group: "prop-bottom", accepts: ["prop-top", "prop-foundation", "prop-roof"], generated: true, confidence: 0.4, source: "bounds" },
    { id: "auto-top", local_pos: tuple(vec(c.x, max.y, c.z)), direction: [0, 1, 0], group: "prop-top", accepts: ["prop-bottom", "prop-foundation", "prop-roof"], generated: true, confidence: 0.4, source: "bounds" },
    { id: "auto-side-east", local_pos: tuple(vec(max.x, c.y, c.z)), direction: [1, 0, 0], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"], generated: true, confidence: 0.35, source: "bounds" },
    { id: "auto-side-west", local_pos: tuple(vec(min.x, c.y, c.z)), direction: [-1, 0, 0], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"], generated: true, confidence: 0.35, source: "bounds" },
    { id: "auto-side-north", local_pos: tuple(vec(c.x, c.y, min.z)), direction: [0, 0, -1], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"], generated: true, confidence: 0.35, source: "bounds" },
    { id: "auto-side-south", local_pos: tuple(vec(c.x, c.y, max.z)), direction: [0, 0, 1], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"], generated: true, confidence: 0.35, source: "bounds" },
  ];
}

function completeWithBounds(snaps: SnapPoint[], bounds: Bounds): SnapPoint[] {
  const byId = new Map(snaps.map((snap) => [snap.id, snap]));
  for (const fallback of boundsFallback(bounds)) {
    const duplicate = snaps.some((snap) => snap.group === fallback.group && snap.direction.join(",") === fallback.direction.join(","));
    if (!byId.has(fallback.id) && !duplicate) byId.set(fallback.id, fallback);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function generateSnapPoints(modelPath: string): SnapPoint[] {
  const model = loadGltf(modelPath);
  const { samples, bounds } = collectSamples(model);
  if (!Number.isFinite(bounds.min.x)) return [];
  const totalArea = samples.reduce((sum, sample) => sum + sample.area, 0);
  const minArea = Math.max(MIN_PLANE_AREA_ABS, totalArea * MIN_PLANE_AREA_RATIO);
  const planes = new Map<string, PlaneAccumulator>();
  for (const sample of samples) addPlane(planes, planeBucket(sample), sample);
  const planeSnaps = [...planes.values()].filter((acc) => acc.area >= minArea).map((acc) => snapFromAccumulator(acc, totalArea));
  return completeWithBounds(planeSnaps, bounds);
}

function resolveModelPath(assetRoot: string, source: string): string {
  return source.startsWith("/") ? source : resolve(assetRoot, source);
}

function main(): void {
  const options = parseArgs();
  const catalog = readCatalog(options.catalogPath);
  ensureCatalogEntries(catalog, options.assetRoot);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const prop of catalog.props) {
    const hasAuthored = Array.isArray(prop.snap_points) && prop.snap_points.length > 0;
    if (hasAuthored && !options.overwriteAuthored) {
      skipped += 1;
      continue;
    }
    const modelPath = resolveModelPath(options.assetRoot, prop.source);
    if (!existsSync(modelPath)) {
      failed += 1;
      console.warn(`[prop-snaps] missing model: ${prop.source}`);
      continue;
    }
    try {
      const snaps = generateSnapPoints(modelPath);
      if (snaps.length === 0) {
        failed += 1;
        console.warn(`[prop-snaps] no snaps generated: ${prop.source}`);
        continue;
      }
      prop.snap_points = snaps;
      delete prop.snapPoints;
      prop.pivot = typeof prop.pivot === "string" ? prop.pivot : "bottom_center";
      updated += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[prop-snaps] failed ${prop.source}`, error);
    }
  }

  catalog.generatedAt = new Date().toISOString();
  if (!options.dryRun) writeCatalog(options.catalogPath, catalog);
  console.info(`[prop-snaps] updated=${updated} skipped=${skipped} failed=${failed} catalog=${options.catalogPath}${options.dryRun ? " dry-run" : ""}`);
}

main();
