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
import type { ResolvedBiomeVisualMaterialState } from "./biome_visual_material_state.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export type BiomeMaterialDomain = "terrain" | "grass" | "tree" | "understory";

export interface BiomeMaterialBinding {
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

const TERRAIN_SNOW_FADE_M = 120;
const nodeClamp = clamp as (...args: TslNode[]) => TslNode;
const nodeMix = mix as (...args: TslNode[]) => TslNode;
const nodeFloat = float as (...args: TslNode[]) => TslNode;
const nodeMax = max as (...args: TslNode[]) => TslNode;
const nodeVec3 = vec3 as (...args: TslNode[]) => TslNode;
const nodeSmoothstep = smoothstep as (...args: TslNode[]) => TslNode;

export function createBiomeVisualMaterialBinding(
  material: THREE.Material,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  const nodeBinding = createNodeMaterialBinding(material, domain);
  if (nodeBinding) return nodeBinding;

  if (material instanceof THREE.ShaderMaterial) {
    if (domain === "terrain") return createClassicTerrainBinding(material);
    if (domain === "grass") return createClassicGrassBinding(material);
    return createCustomShaderFoliageBinding(material, domain);
  }

  return createBuiltInFoliageBinding(material, domain);
}

export function injectBiomeVisualCustomFoliageShader(
  fragmentShader: string,
  includeFlowers: boolean,
): string | null {
  if (!fragmentShader.includes("gl_FragColor")) return null;

  const tinted = fragmentShader.replace(
    /(\bgl_FragColor\s*=\s*[^;]+;)/g,
    "$1\n  gl_FragColor.rgb = biomeVisualFoliageColor(gl_FragColor.rgb);",
  );
  if (tinted === fragmentShader) return null;

  return insertShaderPreamble(
    tinted,
    `${classicUniformDeclarations()}\n${classicFoliageFunction(includeFlowers)}`,
  );
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

function biomeNodeColor(
  baseColor: TslNode,
  domain: BiomeMaterialDomain,
  uniforms: BiomeNodeUniforms,
): TslNode {
  if (domain === "terrain") return terrainNodeColor(baseColor, uniforms);
  if (domain === "grass") return grassNodeColor(baseColor, uniforms);
  return foliageNodeColor(baseColor, uniforms, domain === "understory");
}

function terrainNodeColor(baseColor: TslNode, uniforms: BiomeNodeUniforms): TslNode {
  const dry = nodeFloat(1).sub(uniforms.green);
  let color = nodeMix(
    baseColor,
    baseColor.mul(nodeVec3(0.93, 0.86, 0.68)),
    dry.mul(0.22).mul(uniforms.enabled),
  );
  color = nodeMix(
    color,
    color.mul(nodeVec3(1.08, 0.78, 0.48)),
    uniforms.autumn.mul(0.28).mul(uniforms.enabled),
  );
  color = nodeMix(
    color,
    color.mul(nodeVec3(0.82, 0.88, 0.86)),
    uniforms.dew.mul(0.12).mul(uniforms.enabled),
  );
  color = nodeMix(
    color,
    nodeVec3(0.82, 0.9, 1),
    uniforms.frost.mul(0.18).mul(uniforms.enabled),
  );

  const upness = nodeSmoothstep(0.35, 0.72, nodeClamp(normalWorld.y, 0, 1));
  const snow = nodeSmoothstep(
    uniforms.snowlineM.sub(TERRAIN_SNOW_FADE_M),
    uniforms.snowlineM.add(TERRAIN_SNOW_FADE_M),
    positionWorld.y,
  ).mul(upness).mul(uniforms.enabled);
  return nodeMix(color, nodeVec3(0.86, 0.91, 0.96), snow.mul(0.72));
}

function grassNodeColor(baseColor: TslNode, uniforms: BiomeNodeUniforms): TslNode {
  const dry = nodeMax(nodeFloat(1).sub(uniforms.green), uniforms.autumn.mul(0.8));
  let color = nodeMix(
    baseColor,
    baseColor.mul(nodeVec3(0.95, 0.78, 0.36)),
    dry.mul(0.58).mul(uniforms.enabled),
  );
  color = nodeMix(
    color,
    color.mul(nodeVec3(1.08, 0.76, 0.38)),
    uniforms.autumn.mul(0.28).mul(uniforms.enabled),
  );
  color = nodeMix(
    color,
    nodeVec3(0.78, 0.9, 1),
    uniforms.frost.mul(0.48).mul(uniforms.enabled),
  );
  return color.mul(nodeMix(
    nodeVec3(1),
    nodeVec3(1.05, 1.09, 1.06),
    uniforms.dew.mul(0.16).mul(uniforms.enabled),
  ));
}

function foliageNodeColor(
  baseColor: TslNode,
  uniforms: BiomeNodeUniforms,
  includeFlowers: boolean,
): TslNode {
  const foliage = nodeSmoothstep(
    0.015,
    0.16,
    baseColor.g.sub(nodeMax(baseColor.r, baseColor.b)),
  );
  const dry = nodeMax(nodeFloat(1).sub(uniforms.green), uniforms.autumn.mul(0.7));
  let foliageColor = nodeMix(baseColor, baseColor.mul(nodeVec3(0.94, 0.8, 0.46)), dry.mul(0.5));
  foliageColor = nodeMix(
    foliageColor,
    foliageColor.mul(nodeVec3(1.08, 0.72, 0.38)),
    uniforms.autumn.mul(0.34),
  );
  foliageColor = nodeMix(
    foliageColor,
    nodeVec3(0.8, 0.91, 1),
    uniforms.frost.mul(0.42),
  );
  foliageColor = foliageColor.mul(nodeMix(
    nodeVec3(1),
    nodeVec3(1.04, 1.08, 1.06),
    uniforms.dew.mul(0.14),
  ));

  let color = nodeMix(baseColor, foliageColor, foliage.mul(uniforms.enabled));
  if (includeFlowers) {
    const flower = nodeSmoothstep(0.03, 0.22, baseColor.r.sub(baseColor.g));
    const flowerGain = nodeMix(nodeFloat(0.32), nodeFloat(1), uniforms.bloom);
    color = nodeMix(color, color.mul(flowerGain), flower.mul(uniforms.enabled));
  }
  return color;
}

function createClassicTerrainBinding(material: THREE.ShaderMaterial): BiomeMaterialBinding | null {
  const colorAnchor = "    baseColor = adjustColor(baseColor);";
  if (!material.fragmentShader.includes(colorAnchor)) return null;

  const uniforms = createClassicUniforms();
  Object.assign(material.uniforms, uniforms);
  material.fragmentShader = injectClassicDeclarations(material.fragmentShader)
    .replace("  void main() {", `${classicTerrainFunction()}\n  void main() {`)
    .replace(
      colorAnchor,
      `    baseColor = biomeVisualTerrainColor(baseColor, vWorldPos.y, normalize(vWorldNormal).y);\n${colorAnchor}`,
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

function createCustomShaderFoliageBinding(
  material: THREE.ShaderMaterial,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  if (domain !== "tree" && domain !== "understory") return null;

  const fragmentShader = injectBiomeVisualCustomFoliageShader(
    material.fragmentShader,
    domain === "understory",
  );
  if (!fragmentShader) return null;

  const uniforms = createClassicUniforms();
  Object.assign(material.uniforms, uniforms);
  material.fragmentShader = fragmentShader;
  material.needsUpdate = true;
  return { update: (state) => updateClassicUniforms(uniforms, state) };
}

function createBuiltInFoliageBinding(
  material: THREE.Material,
  domain: BiomeMaterialDomain,
): BiomeMaterialBinding | null {
  if (domain !== "tree" && domain !== "understory") return null;

  const uniforms = createClassicUniforms();
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    const anchor = shader.fragmentShader.includes("#include <opaque_fragment>")
      ? "#include <opaque_fragment>"
      : shader.fragmentShader.includes("#include <output_fragment>")
        ? "#include <output_fragment>"
        : null;
    if (!anchor) return;

    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = injectClassicDeclarations(shader.fragmentShader)
      .replace(
        "void main() {",
        `${classicFoliageFunction(domain === "understory")}\nvoid main() {`,
      )
      .replace(
        anchor,
        `diffuseColor.rgb = biomeVisualFoliageColor(diffuseColor.rgb);\n${anchor}`,
      );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|biome-visual-${domain}-v3`;
  material.needsUpdate = true;
  return { update: (state) => updateClassicUniforms(uniforms, state) };
}

function injectClassicDeclarations(shader: string): string {
  if (shader.includes("precision highp float;")) {
    return shader.replace(
      "precision highp float;",
      `precision highp float;\n${classicUniformDeclarations()}`,
    );
  }
  if (shader.includes("#include <common>")) {
    return shader.replace(
      "#include <common>",
      `#include <common>\n${classicUniformDeclarations()}`,
    );
  }
  return insertShaderPreamble(shader, classicUniformDeclarations());
}

function insertShaderPreamble(shader: string, preamble: string): string {
  const lines = shader.split("\n");
  let insertAt = 0;
  if (lines[0]?.trimStart().startsWith("#version")) insertAt = 1;
  while (insertAt < lines.length) {
    const line = lines[insertAt]?.trim() ?? "";
    if (line.startsWith("#extension") || line.startsWith("precision ") || line.length === 0) {
      insertAt += 1;
      continue;
    }
    break;
  }
  lines.splice(insertAt, 0, preamble);
  return lines.join("\n");
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
    float snow = smoothstep(
      uBiomeVisualSnowlineM - ${TERRAIN_SNOW_FADE_M.toFixed(1)},
      uBiomeVisualSnowlineM + ${TERRAIN_SNOW_FADE_M.toFixed(1)},
      heightM
    );
    snow *= smoothstep(0.35, 0.72, clamp(normalY, 0.0, 1.0));
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

function updateNodeUniforms(
  uniforms: BiomeNodeUniforms,
  state: ResolvedBiomeVisualMaterialState,
): void {
  uniforms.enabled.value = state.enabled;
  uniforms.green.value = state.green;
  uniforms.autumn.value = state.autumn;
  uniforms.bloom.value = state.bloom;
  uniforms.snowlineM.value = state.snowlineM;
  uniforms.frost.value = state.frost;
  uniforms.dew.value = state.dew;
}

function updateClassicUniforms(
  uniforms: BiomeClassicUniforms,
  state: ResolvedBiomeVisualMaterialState,
): void {
  uniforms.uBiomeVisualEnabled.value = state.enabled;
  uniforms.uBiomeVisualGreen.value = state.green;
  uniforms.uBiomeVisualAutumn.value = state.autumn;
  uniforms.uBiomeVisualBloom.value = state.bloom;
  uniforms.uBiomeVisualSnowlineM.value = state.snowlineM;
  uniforms.uBiomeVisualFrost.value = state.frost;
  uniforms.uBiomeVisualDew.value = state.dew;
}
