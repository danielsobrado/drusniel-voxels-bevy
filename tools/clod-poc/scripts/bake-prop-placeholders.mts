/**
 * Bakes minimal placeholder GLBs for the custom-props manifest.
 * Run: npx tsx scripts/bake-prop-placeholders.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "public", "models", "custom_props");

// Unit cube: 8 verts, 12 triangles, POSITION + NORMAL + indices (minimal glTF 2.0 binary).
function buildUnitCubeGlb(): Uint8Array {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "clod-poc-prop-placeholder" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.95 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", max: [0.5, 0.5, 0.5], min: [-0.5, -0.5, -0.5] },
      { bufferView: 1, componentType: 5126, count: 8, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 96 },
      { buffer: 0, byteOffset: 192, byteLength: 72 },
    ],
    buffers: [{ byteLength: 264 }],
  });

  const pos = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const nor = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const idx = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ]);
  const bin = new Uint8Array(264);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nor.buffer), 96);
  bin.set(new Uint8Array(idx.buffer), 192);

  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonChunk = new TextEncoder().encode(json + " ".repeat(jsonPadding));
  const binPadding = (4 - (bin.length % 4)) % 4;
  const binChunk = new Uint8Array(bin.length + binPadding);
  binChunk.set(bin);

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  let offset = 12;
  view.setUint32(offset, jsonChunk.length, true);
  view.setUint32(offset + 4, 0x4e4f534a, true);
  out.set(jsonChunk, offset + 8);
  offset += 8 + jsonChunk.length;
  view.setUint32(offset, binChunk.length, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  out.set(binChunk, offset + 8);
  return out;
}

const PLACEHOLDERS = [
  "crates/crate_a.glb",
  "rocks/rock_large_01.glb",
  "ruins/stone_ruin_wall.glb",
];

const bytes = buildUnitCubeGlb();
for (const rel of PLACEHOLDERS) {
  const outPath = join(outRoot, rel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${bytes.byteLength} bytes)`);
}
