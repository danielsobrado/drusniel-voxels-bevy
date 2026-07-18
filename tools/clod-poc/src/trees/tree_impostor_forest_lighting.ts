import * as THREE from "three";
import {
  attribute,
  clamp,
  float,
  max,
  mix,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import {
  createForestLightingUniforms,
  forestLightingDebugModeValue,
  updateForestLightingUniforms,
  type ForestLightingMaterialState,
  type ForestLightingUniforms,
} from "../forest_lighting/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface NodeMaterialShape extends THREE.Material {
  colorNode?: TslNode;
}

interface ImpostorForestLightingHandle {
  update(state: ForestLightingMaterialState | null): void;
  dispose(): void;
}

interface NodeForestLightingState {
  packedNode: TslNode;
  auxNode: TslNode;
  enabled: TslNode;
  worldSize: TslNode;
  aoStrength: TslNode;
  shadowStrength: TslNode;
  fogStrength: TslNode;
  debugMode: TslNode;
}

export const TREE_IMPOSTOR_FOREST_LIGHTING_KEY = "treeImpostorForestLighting";

const AERIAL_TINT_SCALE = 0.15;
const AERIAL_TINT_MAX = 0.04;
const SHAFT_HINT_SCALE = 0.01;
const FOREST_DARKEN_MAX = 0.72;
const FOREST_FOG_COLOR = new THREE.Vector3(0.4, 0.4431372549, 0.4274509804);

export function decorateTreeImpostorForestLighting(
  material: THREE.Material,
  webgpu: boolean,
  state: ForestLightingMaterialState | null = null,
): THREE.Material {
  if (material.userData[TREE_IMPOSTOR_FOREST_LIGHTING_KEY]) {
    updateTreeImpostorMaterialForestLighting(material, state);
    return material;
  }

  const handle = webgpu
    ? createNodeForestLightingHandle(material as NodeMaterialShape)
    : createShaderForestLightingHandle(material as THREE.ShaderMaterial);
  material.userData[TREE_IMPOSTOR_FOREST_LIGHTING_KEY] = handle;
  material.addEventListener("dispose", handle.dispose);
  handle.update(state);
  return material;
}

export function updateTreeImpostorMaterialForestLighting(
  material: THREE.Material,
  state: ForestLightingMaterialState | null,
): boolean {
  const handle = material.userData[TREE_IMPOSTOR_FOREST_LIGHTING_KEY] as ImpostorForestLightingHandle | undefined;
  if (!handle) return false;
  handle.update(state);
  return true;
}

function createNodeForestLightingHandle(material: NodeMaterialShape): ImpostorForestLightingHandle {
  const baseColor = material.colorNode;
  if (!baseColor) throw new Error("tree impostor node material does not expose a color node");

  const packedTexture = createNeutralForestTexture("tree-impostor-forest-neutral-packed");
  const auxTexture = createNeutralForestTexture("tree-impostor-forest-neutral-aux");
  const worldXZ: TslNode = attribute("treeWorldXZ", "vec2");
  const nodeState: NodeForestLightingState = {
    packedNode: texture(packedTexture, vec2(0)),
    auxNode: texture(auxTexture, vec2(0)),
    enabled: uniform(0),
    worldSize: uniform(1),
    aoStrength: uniform(1),
    shadowStrength: uniform(1),
    fogStrength: uniform(0),
    debugMode: uniform(0),
  };

  const forestUv: TslNode = clamp(worldXZ.div(nodeState.worldSize), vec2(0), vec2(1));
  nodeState.packedNode.uvNode = forestUv;
  nodeState.auxNode.uvNode = forestUv;
  const packed: TslNode = nodeState.packedNode;
  const aux: TslNode = nodeState.auxNode;
  const darken: TslNode = clamp(
    packed.x.mul(nodeState.aoStrength).add(packed.y.mul(nodeState.shadowStrength)),
    0,
    FOREST_DARKEN_MAX,
  ).mul(nodeState.enabled);
  const fog: TslNode = clamp(
    packed.z.mul(nodeState.fogStrength).mul(nodeState.enabled),
    0,
    AERIAL_TINT_MAX,
  );
  const shaded: TslNode = mix(
    baseColor.mul(float(1).sub(darken)),
    vec3(FOREST_FOG_COLOR),
    fog,
  ).add(vec3(packed.w.mul(SHAFT_HINT_SCALE).mul(nodeState.enabled)));
  const debugColor = forestDebugColorNode(nodeState.debugMode, packed, aux);
  const debugActive: TslNode = nodeState.enabled.greaterThan(0.5).and(nodeState.debugMode.greaterThan(0.5));
  material.colorNode = debugActive.select(debugColor, shaded);

  let disposed = false;
  return {
    update(state) {
      if (!state) {
        nodeState.enabled.value = 0;
        return;
      }
      const settings = state.settings;
      nodeState.enabled.value = settings.enabled && settings.materialIntegration.treeEnabled ? 1 : 0;
      nodeState.worldSize.value = Math.max(1, state.worldCells);
      nodeState.aoStrength.value = settings.ambientOcclusion.strength;
      nodeState.shadowStrength.value = settings.shadowProxy.strength;
      nodeState.fogStrength.value = settings.atmosphere.aerialTintStrength * AERIAL_TINT_SCALE;
      nodeState.debugMode.value = forestLightingDebugModeValue(settings.materialIntegration.debugMode);
      nodeState.packedNode.value = state.textureHandle.texture;
      nodeState.auxNode.value = state.textureHandle.auxTexture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      packedTexture.dispose();
      auxTexture.dispose();
    },
  };
}

function forestDebugColorNode(debugMode: TslNode, packed: TslNode, aux: TslNode): TslNode {
  const combined: TslNode = vec3(packed.x, packed.y, max(packed.z, aux.y));
  return debugMode.lessThan(1.5).select(
    vec3(aux.x),
    debugMode.lessThan(2.5).select(
      vec3(packed.x),
      debugMode.lessThan(3.5).select(
        vec3(packed.y),
        debugMode.lessThan(4.5).select(
          vec3(packed.z),
          debugMode.lessThan(5.5).select(vec3(packed.w), combined),
        ),
      ),
    ),
  );
}

function createShaderForestLightingHandle(material: THREE.ShaderMaterial): ImpostorForestLightingHandle {
  const packedTexture = createNeutralForestTexture("tree-impostor-forest-neutral-packed");
  const auxTexture = createNeutralForestTexture("tree-impostor-forest-neutral-aux");
  const uniforms = createForestLightingUniforms();
  uniforms.uForestLightingMap.value = packedTexture;
  uniforms.uForestLightingAuxMap.value = auxTexture;
  Object.assign(material.uniforms, uniforms);
  material.vertexShader = injectImpostorForestVertexShader(material.vertexShader);
  material.fragmentShader = injectImpostorForestFragmentShader(material.fragmentShader);
  material.needsUpdate = true;

  let disposed = false;
  return {
    update(state) {
      updateForestLightingUniforms(uniforms, state, "tree");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      packedTexture.dispose();
      auxTexture.dispose();
    },
  };
}

function injectImpostorForestVertexShader(source: string): string {
  const transformed = source
    .replace(
      "attribute vec2 treeWorldXZ;",
      "attribute vec2 treeWorldXZ;\nvarying vec2 vTreeImpostorForestWorldXZ;",
    )
    .replace(
      "void main() {",
      "void main() {\n  vTreeImpostorForestWorldXZ = treeWorldXZ;",
    );
  if (!transformed.includes("vTreeImpostorForestWorldXZ = treeWorldXZ")) {
    throw new Error("tree impostor forest-lighting vertex transform failed");
  }
  return transformed;
}

function injectImpostorForestFragmentShader(source: string): string {
  const declarations = `uniform float alphaTest;\nvarying vec2 vTreeImpostorForestWorldXZ;\nuniform sampler2D uForestLightingMap;\nuniform sampler2D uForestLightingAuxMap;\nuniform float uForestLightingEnabled;\nuniform float uForestLightingWorldSize;\nuniform float uForestAoStrength;\nuniform float uForestShadowStrength;\nuniform float uForestFogStrength;\nuniform vec3 uForestFogColor;\nuniform float uForestDebugMode;`;
  const helper = `\nvec3 applyTreeImpostorForestLighting(vec3 baseColor) {\n  if (uForestLightingEnabled <= 0.5) return baseColor;\n  vec2 forestUv = clamp(vTreeImpostorForestWorldXZ / max(uForestLightingWorldSize, 0.0001), vec2(0.0), vec2(1.0));\n  vec4 forestPacked = texture2D(uForestLightingMap, forestUv);\n  vec4 forestAux = texture2D(uForestLightingAuxMap, forestUv);\n  float forestAo = forestPacked.r;\n  float forestShadow = forestPacked.g;\n  float forestFog = forestPacked.b;\n  float forestShaft = forestPacked.a;\n  if (uForestDebugMode > 0.5) {\n    if (uForestDebugMode < 1.5) return vec3(forestAux.r);\n    if (uForestDebugMode < 2.5) return vec3(forestAo);\n    if (uForestDebugMode < 3.5) return vec3(forestShadow);\n    if (uForestDebugMode < 4.5) return vec3(forestFog);\n    if (uForestDebugMode < 5.5) return vec3(forestShaft);\n    return vec3(forestAo, forestShadow, max(forestFog, forestAux.g));\n  }\n  float forestDarken = clamp(forestAo * uForestAoStrength + forestShadow * uForestShadowStrength, 0.0, ${FOREST_DARKEN_MAX.toFixed(2)});\n  vec3 color = baseColor * (1.0 - forestDarken);\n  color = mix(color, uForestFogColor, clamp(forestFog * uForestFogStrength, 0.0, ${AERIAL_TINT_MAX.toFixed(2)}));\n  return color + vec3(forestShaft * ${SHAFT_HINT_SCALE.toFixed(2)});\n}\n`;
  let transformed = source
    .replace("uniform float alphaTest;", declarations)
    .replace("void main() {", `${helper}\nvoid main() {`);
  const singleOutput = "gl_FragColor = vec4(albedo, color.a);";
  const blendOutput = "gl_FragColor = vec4(albedo, coverage);";
  if (transformed.includes(singleOutput)) {
    transformed = transformed.replace(singleOutput, `albedo = applyTreeImpostorForestLighting(albedo);\n  ${singleOutput}`);
  } else if (transformed.includes(blendOutput)) {
    transformed = transformed.replace(blendOutput, `albedo = applyTreeImpostorForestLighting(albedo);\n  ${blendOutput}`);
  } else {
    throw new Error("tree impostor forest-lighting fragment output transform failed");
  }
  if (!transformed.includes("applyTreeImpostorForestLighting(albedo)")) {
    throw new Error("tree impostor forest-lighting fragment transform failed");
  }
  return transformed;
}

function createNeutralForestTexture(name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
