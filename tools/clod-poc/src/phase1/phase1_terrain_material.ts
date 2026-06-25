import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../types.js";
import type { HeightfieldSampler } from "./heightfield_sampler.js";
import type { Phase1DebugMode, Phase1TerrainConfig } from "./phase1_config.js";

const BIOME_COLORS = [
  new THREE.Color(0x536b3b),
  new THREE.Color(0x8a744c),
  new THREE.Color(0x77726a),
  new THREE.Color(0xd9e8ee),
] as const;

const LOD_COLORS = [
  new THREE.Color(0x56b870),
  new THREE.Color(0xe1c15a),
  new THREE.Color(0xd77c3f),
  new THREE.Color(0xa35ddb),
  new THREE.Color(0x64b5f6),
] as const;

function heightColor(height: number, config: Phase1TerrainConfig): THREE.Color {
  const t = THREE.MathUtils.clamp(height / config.world.heightScaleM, 0, 1);
  return new THREE.Color().setHSL(0.62 - t * 0.52, 0.65, 0.28 + t * 0.45);
}

function slopeColor(slope: number): THREE.Color {
  return new THREE.Color().setHSL(0.34 - THREE.MathUtils.clamp(slope, 0, 1) * 0.34, 0.8, 0.42);
}

function flowColor(flow: number): THREE.Color {
  const t = THREE.MathUtils.clamp(flow, 0, 1);
  return new THREE.Color(t * 0.12, 0.18 + t * 0.38, 0.22 + t * 0.72);
}

function normalColor(normal: [number, number, number]): THREE.Color {
  return new THREE.Color(normal[0] * 0.5 + 0.5, normal[1] * 0.5 + 0.5, normal[2] * 0.5 + 0.5);
}

function paintWeightColor(sample: { height: number; slope: number; flow: number; biome: number }, config: Phase1TerrainConfig): THREE.Color {
  const rock = THREE.MathUtils.smoothstep(sample.slope, config.material.slopeRockStart, config.material.slopeRockFull);
  const snow = sample.height > config.material.heightBands[3]?.minM ? 1 - THREE.MathUtils.clamp(sample.slope / config.material.snowSlopeFade, 0, 1) : 0;
  return new THREE.Color(0.15 + rock * 0.7, 0.2 + (1 - rock) * 0.45, 0.2 + snow * 0.75);
}

function pageSourceSectionColor(sample: { materialWeights: [number, number, number, number] }): THREE.Color {
  const grass = sample.materialWeights[0];
  const sandOrDirt = sample.materialWeights[1];
  const rock = sample.materialWeights[2];
  if (rock > sandOrDirt && rock > grass) return new THREE.Color(0xd96b38);
  if (sandOrDirt > grass) return new THREE.Color(0xe3c66d);
  return new THREE.Color(0x35c95c);
}

export function createPhase1TerrainMaterial(mode: Phase1DebugMode): THREE.Material {
  if (mode === "final") {
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  }
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

export function geometryForPhase1Node(
  node: ClodPageNode,
  sampler: HeightfieldSampler,
  config: Phase1TerrainConfig,
  mode: Phase1DebugMode,
): THREE.BufferGeometry {
  const mesh = node.mesh;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.setAttribute("color", new THREE.BufferAttribute(colorsForMode(mesh, node, sampler, config, mode), 3));
  return geometry;
}

function colorsForMode(
  mesh: PageMesh,
  node: ClodPageNode,
  sampler: HeightfieldSampler,
  config: Phase1TerrainConfig,
  mode: Phase1DebugMode,
): Float32Array {
  const out = new Float32Array(mesh.positions.length);
  const color = new THREE.Color();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const z = mesh.positions[i + 2];
    const sample = sampler.sample(x, z);
    if (mode === "lod") color.copy(LOD_COLORS[node.level % LOD_COLORS.length]);
    else if (mode === "height") color.copy(heightColor(sample.height, config));
    else if (mode === "slope") color.copy(slopeColor(sample.slope));
    else if (mode === "normal") color.copy(normalColor(sampler.normalAt(x, z)));
    else if (mode === "flow") color.copy(flowColor(sample.flow));
    else if (mode === "biome") color.copy(BIOME_COLORS[sample.biome] ?? BIOME_COLORS[0]);
    else if (mode === "paint_weights") color.copy(paintWeightColor(sample, config));
    else if (mode === "page_source_sections") color.copy(pageSourceSectionColor(sample));
    else {
      const biomeColor = BIOME_COLORS[sample.biome] ?? BIOME_COLORS[0];
      const slopeRock = THREE.MathUtils.smoothstep(sample.slope, config.material.slopeRockStart, config.material.slopeRockFull);
      color.copy(biomeColor).lerp(new THREE.Color(0x827b70), slopeRock * 0.45);
    }
    out[i] = color.r;
    out[i + 1] = color.g;
    out[i + 2] = color.b;
  }
  return out;
}
