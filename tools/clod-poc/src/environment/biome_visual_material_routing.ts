import * as THREE from "three";
import {
  clamp,
  float,
  max,
  mix,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import type { GrassController } from "../runtime/vegetation/grass_controller.js";
import type { TerrainMaterialController } from "../terrain/material/terrain_material_controller.js";
import type { TerrainMaterialHandle } from "../rendering/terrain_material.js";
import type { BiomeVisualState } from "./biome_visual_state.js";
import { readActiveBiomeVisualState } from "./biome_visual_state_runtime.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;
type BiomeMaterialDomain = "terrain" | "grass" | "tree" | "understory";

const MATERIAL_SCAN_INTERVAL_FRAMES = 30;
const TERRAIN_SNOW_FADE_M = 120;

const installedControllers = new WeakSet<GrassController>();
const materialBindings = new WeakMap<THREE.Material, BiomeMaterialBinding>();

export interface BiomeVisualMaterialRoutingInput {
  readonly scene: THREE.Scene;
  readonly materialController: TerrainMaterialController;
  readonly grassController: GrassController;
}

export interface ResolvedBiomeVisualMaterialState {
  readonly enabled: number;
  readonly green: number;
  readonly autumn: number;
  readonly bloom: number;
  readonly snowlineM: number;
  readonly frost: number;
  readonly dew: number;
}

interface BiomeMaterialBinding {
  update(state: ResolvedBiomeVisualMaterialState): void;
}

interface BiomeNodeUniforms {
  enabled: TslNode;
  green: TslNode;
  autumn: TslNode;
  bloom: TslNode;
  snowlineM: TslNode;
  frost: TslNode;
  dew: TslNode;
}

interface BiomeClassicUniforms {
  uBiomeVisualEnabled: { value: number };
  uBiomeVisualGreen: { value: number };
  uBiomeVisualAutumn: { value: number };
  uBiomeVisualBloom: { value: number };
  uBiomeVisualSnowlineM: { value: number };
  uBiomeVisualFrost: { value: number };
  uBiomeVisualDew: { value: number };
}

export function installBiomeVisualMaterialRouting(input: BiomeVisualMaterialRoutingInput): void {
  if (installedControllers.has(input.grassController)) return;
  installedControllers.add(input.grassController);

  let frame = 0;
  let lastSignature = "";
  let current = resolveBiomeVisualMaterialState(readActiveBiomeVisualState());
  const bindings = new Set<BiomeMaterialBinding>();
  const terrainHandles = new WeakSet<TerrainMaterialHandle>();

  const bindMaterial = (material: THREE.Material, domain: BiomeMaterialDomain): void => {
    if (isDebugMaterial(material)) return;
    const existing = materialBindings.get(material);
    if (existing) {
      bindings.add(existing);
      existing.update(current);
      return;
    }
    const binding = createMaterialBinding(material, domain);
    if (!binding) return;
    materialBindings.set(material, binding);
    bindings.add(binding);
    binding.update(current);
  };

  const bindTerrainHandle = (handle: TerrainMaterialHandle): void => {
    if (terrainHandles.has(handle)) return;
    terrainHandles.add(handle);
    bindMaterial(handle.material, "terrain");
    handle.onMaterialChanged((material) => bindMaterial(material, "terrain"));
  };

  const scanMaterials = (): void => {
    for (const handle of input.materialController.materials) bindTerrainHandle(handle);
    input.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const domain = biomeMaterialDomain(object);
      if (!domain) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) bindMaterial(material, domain);
    });
  };

  const tick = (): void => {
    const next = resolveBiomeVisualMaterialState(readActiveBiomeVisualState());
    const signature = biomeVisualMaterialStateSignature(next);
    const shouldScan = frame++ % MATERIAL_SCAN_INTERVAL_FRAMES === 0;
    if (shouldScan) scanMaterials();
    if (signature === lastSignature) return;
    current = next;
    lastSignature = signature;
    for (const binding of bindings) binding.update(current);
  };

  const makeTerrainMaterial = input.materialController.makeTerrainMaterial.bind(input.materialController);
  input.materialController.makeTerrainMaterial = (color) => {
    const handle = makeTerrainMaterial(color);
    bindTerrainHandle(handle);
    return handle;
  };

  const configureChunkMaterial = input.materialController.configureChunkMaterial.bind(input.materialController);
  input.materialController.configureChunkMaterial = (handle) => {
    configureChunkMaterial(handle);
    bindTerrainHandle(handle);
    tick();
  };

  const updateGrass = input.grassController.update.bind(input.grassController);
  input.grassController.update = (elapsedSeconds, ringCenter, camera) => {
    tick();
    updateGrass(elapsedSeconds, ringCenter, camera);
  };

  scanMaterials();
  tick();
}

export function resolveBiomeVisualMaterialState(
  state: BiomeVisualState | null,
): ResolvedBiomeVisualMaterialState {
  if (!state?.enabled) {
    return {
      enabled: 0,
      green: 1,
      autumn: 0,
      bloom: 1,
      snowlineM: 1_000_000,
      frost: 0,
      dew: 0,
    };
  }
  const frost = clamp01(state.frostAmount);
  return {
    enabled: 1,
    green: clamp01(state.green),
    autumn: clamp01(state.autumn),
    bloom: clamp01(state.bloom),
    snowlineM: finiteAtLeast(state.snowlineM, 0, 1_000_000),
    frost,
    dew: clamp01(state.wetness) * (1 - frost),
  };
}

export function biomeVisualMaterialStateSignature(state: ResolvedBiomeVisualMaterialState): string {
  return [
    state.enabled,
    state.green,
    state.autumn,
    state.bloom,
    state.snowlineM,
    state.frost,
    state.dew,
  ].map((value) => value.toFixed(5)).join("|");
}

export function resolveGrassSeasonalColor(
  color: readonly [number, number, number],
  state: ResolvedBiomeVisualMaterialState,
): [number, number, number] {
  if (state.enabled === 0) return [...color];
  const dry = Math.max(1 - state.green, state.autumn * 0.8);
  let next = multiplyColor(color, mixColor([1, 1, 1], [0.95, 0.78, 0.36], dry * 0.58));
  next = multiplyColor(next, mixColor([1, 1, 1], [1.08, 0.76, 0.38], state.autumn * 0.28));
  next = mixColor(next, [0.78, 0.9, 1], state.frost * 0.48);
  return multiplyColor(next, mixColor([1, 1, 1], [1.05, 1.09, 1.06], state.dew * 0.16));
}

function createMaterialBinding(
  material: THREE.Material,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  const nodeBinding = createNodeMaterialBinding(material, domain);
  if (nodeBinding) return nodeBinding;
  if (domain === "terrain" && material instanceof THREE.ShaderMaterial) {
    return createClassicTerrainBinding(material);
  }
  if (domain === "grass" && material instanceof THREE.ShaderMaterial) {
    return createClassicGrassBinding(material);
  }
  return createClassicFoliageBinding(material, domain);
}

function createNodeMaterialBinding(
  material: THREE.Material,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  const nodeMaterial = material as THREE.Material & { colorNode?: TslNode };
  if (!nodeMaterial.colorNode) return null;
  const uniforms = createNodeUniforms();
  nodeMaterial.colorNode = biomeNodeColor(nodeMaterial.colorNode, domain, uniforms);
  material.needsUpdate = true;
  return { update: (state) => updateNodeUniforms(uniforms, state) };
}

function biomeNodeColor(baseColor: TslNode, domain: BiomeMaterialDomain, uniforms: BiomeNodeUniforms): TslNode {
  if (domain === "terrain") return terrainNodeColor(baseColor, uniforms);
  if (domain === "grass") return grassNodeColor(baseColor, uniforms);
  return foliageNodeColor(baseColor, uniforms, domain === "understory");
}

function terrainNodeColor(baseColor: TslNode, uniforms: BiomeNodeUniforms): TslNode {
  const dry = float(1).sub(uniforms.green);
  let color = mix(baseColor, baseColor.mul(vec3(0.93, 0.86, 0.68)), dry.mul(0.22).mul(uniforms.enabled));
  color = mix(color, color.mul(vec3(1.08, 0.78, 0.48)), uniforms.autumn.mul(0.28).mul(uniforms.enabled));
  color = mix(color, color.mul(vec3(0.82, 0.88, 0.86)), uniforms.dew.mul(0.12).mul(uniforms.enabled));
  color = mix(color, vec3(0.82, 0.9, 1), uniforms.frost.mul(0.18).mul(uniforms.enabled));
  const upness = smoothstep(0.35, 0.72, clamp(normalWorld.y, 0, 1));
  const snow = smoothstep(
    uniforms.snowlineM.sub(TERRAIN_SNOW_FADE_M),
    uniforms.snowlineM.add(TERRAIN_SNOW_FADE_M),
    positionWorld.y,
  ).mul(upness).mul(uniforms.enabled);
  return mix(color, vec3(0.86, 0.91, 0.96), snow.mul(0.72));
}

function grassNodeColor(baseColor: TslNode, uniforms: BiomeNodeUniforms): TslNode {
  const dry = max(float(1).sub(uniforms.green), uniforms.autumn.mul(0.8));
  let color = mix(baseColor, baseColor.mul(vec3(0.95, 0.78, 0.36)), dry.mul(0.58).mul(uniforms.enabled));
  color = mix(color, color.mul(vec3(1.08, 0.76, 0.38)), uniforms.autumn.mul(0.28).mul(uniforms.enabled));
  color = mix(color, vec3(0.78, 0.9, 1), uniforms.frost.mul(0.48).mul(uniforms.enabled));
  return color.mul(mix(vec3(1), vec3(1.05, 1.09, 1.06), uniforms.dew.mul(0.16).mul(uniforms.enabled)));
}

function foliageNodeColor(
  baseColor: TslNode,
  uniforms: BiomeNodeUniforms,
  includeFlowers: boolean,
): TslNode {
  const foliage = smoothstep(0.015, 0.16, baseColor.g.sub(max(baseColor.r, baseColor.b)));
  const dry = max(float(1).sub(uniforms.green), uniforms.autumn.mul(0.7));
  let foliageColor = mix(baseColor, baseColor.mul(vec3(0.94, 0.8, 0.46)), dry.mul(0.5));
  foliageColor = mix(foliageColor, foliageColor.mul(vec3(1.08, 0.72, 0.38)), uniforms.autumn.mul(0.34));
  foliageColor = mix(foliageColor, vec3(0.8, 0.91, 1), uniforms.frost.mul(0.42));
  foliageColor = foliageColor.mul(mix(vec3(1), vec3(1.04, 1.08, 1.06), uniforms.dew.mul(0.14)));
  let color = mix(baseColor, foliageColor, foliage.mul(uniforms.enabled));
  if (includeFlowers) {
    const flower = smoothstep(0.03, 0.22, baseColor.r.sub(baseColor.g));
    const flowerGain = mix(float(0.32), float(1), uniforms.bloom);
    color = mix(color, color.mul(flowerGain), flower.mul(uniforms.enabled));
  }
  return color;
}

function createClassicTerrainBinding(material: THREE.ShaderMaterial): BiomeMaterialBinding | null {
  if (!material.fragmentShader.includes("baseColor = adjustColor(baseColor);")) return null;
  const uniforms = createClassicUniforms();
  Object.assign(material.uniforms, uniforms);
  material.fragmentShader = injectClassicDeclarations(material.fragmentShader)
    .replace("  void main() {", `${classicTerrainFunction()}\n  void main() {`)
    .replace(
      "    baseColor = adjustColor(baseColor);",
      "    baseColor = biomeVisualTerrainColor(baseColor, vWorldPos.y, normalize(vWorldNormal).y);\n    baseColor = adjustColor(baseColor);",
    );
  material.needsUpdate = true;
  return { update: (state) => updateClassicUniforms(uniforms, state) };
}

function createClassicGrassBinding(material: THREE.ShaderMaterial): BiomeMaterialBinding | null {
  const hasClassicColor = material.fragmentShader.includes("vec3 grassColor =");
  const hasPatchColor = material.fragmentShader.includes("vec3 color = mix(base, mid");
  if (!hasClassicColor && !hasPatchColor) return null;
  const uniforms = createClassicUniforms();
  Object.assign(material.uniforms, uniforms);
  let shader = injectClassicDeclarations(material.fragmentShader)
    .replace("  void main() {", `${classicGrassFunction()}\n  void main() {`);
  if (hasClassicColor) {
    shader = shader.replace(
      "    vec3 n = normalize(vWorldNormal);",
      "    grassColor = biomeVisualGrassColor(grassColor);\n    vec3 n = normalize(vWorldNormal);",
    );
  }
  if (hasPatchColor) {
    shader = shader.replace(
      "    vec3 n = normalize(vWorldNormal);",
      "    color = biomeVisualGrassColor(color);\n    vec3 n = normalize(vWorldNormal);",
    );
  }
  material.fragmentShader = shader;
  material.needsUpdate = true;
  return { update: (state) => updateClassicUniforms(uniforms, state) };
}

function createClassicFoliageBinding(
  material: THREE.Material,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  if (domain !== "tree" && domain !== "understory") return null;
  const uniforms = createClassicUniforms();
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = injectClassicDeclarations(shader.fragmentShader)
      .replace("void main() {", `${classicFoliageFunction(domain === "understory")}\nvoid main() {`);
    const anchor = shader.fragmentShader.includes("#include <opaque_fragment>")
      ? "#include <opaque_fragment>"
      : "#include <output_fragment>";
    shader.fragmentShader = shader.fragmentShader.replace(
      anchor,
      `diffuseColor.rgb = biomeVisualFoliageColor(diffuseColor.rgb);\n${anchor}`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|biome-visual-${domain}-v1`;
  material.needsUpdate = true;
  return { update: (state) => updateClassicUniforms(uniforms, state) };
}

function injectClassicDeclarations(shader: string): string {
  const anchor = shader.includes("precision highp float;") ? "precision highp float;" : "#include <common>";
  return shader.replace(anchor, `${anchor}\n${classicUniformDeclarations()}`);
}

function classicUniformDeclarations(): string {
  return `uniform float uBiomeVisualEnabled;
uniform float uBiomeVisualGreen;
uniform float uBiomeVisualAutumn;
uniform float uBiomeVisualBloom;
uniform float uBiomeVisualSnowlineM;
uniform float uBiomeVisualFrost;
uniform float uBiomeVisualDew;`;
}

function classicTerrainFunction(): string {
  return `  vec3 biomeVisualTerrainColor(vec3 color, float heightM, float normalY) {
    if (uBiomeVisualEnabled < 0.5) return color;
    float dry = 1.0 - uBiomeVisualGreen;
    color = mix(color, color * vec3(0.93, 0.86, 0.68), dry * 0.22);
    color = mix(color, color * vec3(1.08, 0.78, 0.48), uBiomeVisualAutumn * 0.28);
    color = mix(color, color * vec3(0.82, 0.88, 0.86), uBiomeVisualDew * 0.12);
    color = mix(color, vec3(0.82, 0.90, 1.00), uBiomeVisualFrost * 0.18);
    float snow = smoothstep(uBiomeVisualSnowlineM - ${TERRAIN_SNOW_FADE_M.toFixed(1)}, uBiomeVisualSnowlineM + ${TERRAIN_SNOW_FADE_M.toFixed(1)}, heightM);
    snow *= smoothstep(0.35, 0.72, normalY);
    return mix(color, vec3(0.86, 0.91, 0.96), snow * 0.72);
  }`;
}

function classicGrassFunction(): string {
  return `  vec3 biomeVisualGrassColor(vec3 color) {
    if (uBiomeVisualEnabled < 0.5) return color;
    float dry = max(1.0 - uBiomeVisualGreen, uBiomeVisualAutumn * 0.8);
    color = mix(color, color * vec3(0.95, 0.78, 0.36), dry * 0.58);
    color = mix(color, color * vec3(1.08, 0.76, 0.38), uBiomeVisualAutumn * 0.28);
    color = mix(color, vec3(0.78, 0.90, 1.00), uBiomeVisualFrost * 0.48);
    return color * mix(vec3(1.0), vec3(1.05, 1.09, 1.06), uBiomeVisualDew * 0.16);
  }`;
}

function classicFoliageFunction(includeFlowers: boolean): string {
  const flower = includeFlowers
    ? `
    float flower = smoothstep(0.03, 0.22, baseColor.r - baseColor.g);
    color = mix(color, color * mix(0.32, 1.0, uBiomeVisualBloom), flower);`
    : "";
  return `vec3 biomeVisualFoliageColor(vec3 baseColor) {
    if (uBiomeVisualEnabled < 0.5) return baseColor;
    float foliage = smoothstep(0.015, 0.16, baseColor.g - max(baseColor.r, baseColor.b));
    float dry = max(1.0 - uBiomeVisualGreen, uBiomeVisualAutumn * 0.7);
    vec3 foliageColor = mix(baseColor, baseColor * vec3(0.94, 0.80, 0.46), dry * 0.50);
    foliageColor = mix(foliageColor, foliageColor * vec3(1.08, 0.72, 0.38), uBiomeVisualAutumn * 0.34);
    foliageColor = mix(foliageColor, vec3(0.80, 0.91, 1.00), uBiomeVisualFrost * 0.42);
    foliageColor *= mix(vec3(1.0), vec3(1.04, 1.08, 1.06), uBiomeVisualDew * 0.14);
    vec3 color = mix(baseColor, foliageColor, foliage);${flower}
    return color;
  }`;
}

function createNodeUniforms(): BiomeNodeUniforms {
  return {
    enabled: uniform(0),
    green: uniform(1),
    autumn: uniform(0),
    bloom: uniform(1),
    snowlineM: uniform(1_000_000),
    frost: uniform(0),
    dew: uniform(0),
  };
}

function createClassicUniforms(): BiomeClassicUniforms {
  return {
    uBiomeVisualEnabled: { value: 0 },
    uBiomeVisualGreen: { value: 1 },
    uBiomeVisualAutumn: { value: 0 },
    uBiomeVisualBloom: { value: 1 },
    uBiomeVisualSnowlineM: { value: 1_000_000 },
    uBiomeVisualFrost: { value: 0 },
    uBiomeVisualDew: { value: 0 },
  };
}

function updateNodeUniforms(uniforms: BiomeNodeUniforms, state: ResolvedBiomeVisualMaterialState): void {
  uniforms.enabled.value = state.enabled;
  uniforms.green.value = state.green;
  uniforms.autumn.value = state.autumn;
  uniforms.bloom.value = state.bloom;
  uniforms.snowlineM.value = state.snowlineM;
  uniforms.frost.value = state.frost;
  uniforms.dew.value = state.dew;
}

function updateClassicUniforms(uniforms: BiomeClassicUniforms, state: ResolvedBiomeVisualMaterialState): void {
  uniforms.uBiomeVisualEnabled.value = state.enabled;
  uniforms.uBiomeVisualGreen.value = state.green;
  uniforms.uBiomeVisualAutumn.value = state.autumn;
  uniforms.uBiomeVisualBloom.value = state.bloom;
  uniforms.uBiomeVisualSnowlineM.value = state.snowlineM;
  uniforms.uBiomeVisualFrost.value = state.frost;
  uniforms.uBiomeVisualDew.value = state.dew;
}

function biomeMaterialDomain(object: THREE.Object3D): Exclude<BiomeMaterialDomain, "terrain"> | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.name === "grass") return "grass";
    if (current.name === "trees") return "tree";
    if (current.name === "understory") return "understory";
    current = current.parent;
  }
  return null;
}

function isDebugMaterial(material: THREE.Material): boolean {
  return material.name.toLowerCase().includes("debug");
}

function multiplyColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

function mixColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  const t = clamp01(amount);
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ];
}

function finiteAtLeast(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
