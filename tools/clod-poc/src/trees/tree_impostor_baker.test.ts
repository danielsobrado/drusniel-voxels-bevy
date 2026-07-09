import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bakeTreeImpostorAtlases,
  cloneTreeSettings,
  decodeTreeImpostorAlbedo,
  decodeTreeImpostorDepth,
  decodeTreeImpostorNormalComponent,
  encodeTreeImpostorAlbedo,
  encodeTreeImpostorDepth,
  encodeTreeImpostorNormalComponent,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
  TREE_SPECIES,
  type TreeGeometryMap,
  type TreeSettings,
} from "./index.js";

describe("tree impostor baker", () => {
  it("accepts a render-target renderer without a WebGL context", async () => {
    const settings = impostorSettings();
    const renderer = fakeRenderTargetRenderer();
    const result = await bakeTreeImpostorAtlases({
      renderer,
      settings,
      geometries: geometryMap(),
      material: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    });

    expect("getContext" in renderer).toBe(false);
    expect(result.supported).toBe(true);
    expect(result.reason).toBeNull();
    for (const species of TREE_SPECIES) {
      const atlas = result.atlases[species];
      expect(atlas?.ready).toBe(true);
      expect(atlas?.albedo).toBeDefined();
      expect(atlas?.normalDepth).toBeDefined();
      expect(atlas?.texture).toBe(atlas?.albedo);
      expect(atlas?.gridSize).toBe(settings.impostors.octahedralGridSize);
      expect(atlas?.frames).toHaveLength(settings.impostors.octahedralGridSize ** 2);
      expect(atlas?.radius).toBeGreaterThan(0);
      atlas?.dispose();
    }
    expect(renderer.renderCalls).toBe(TREE_SPECIES.length * settings.impostors.octahedralGridSize ** 2 * 2);
  });

  it("uses a WebGPU-compatible normal-depth material when requested", async () => {
    const settings = impostorSettings();
    const renderer = fakeRenderTargetRenderer({ rejectShaderMaterial: true });
    const result = await bakeTreeImpostorAtlases({
      renderer,
      settings,
      geometries: geometryMap(),
      material: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      webgpu: true,
    });

    expect(result.supported).toBe(true);
    expect(result.reason).toBeNull();
    for (const species of TREE_SPECIES) result.atlases[species]?.dispose();
  });

  it("round-trips impostor albedo, normal, and depth encode/decode helpers", () => {
    for (const value of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(decodeTreeImpostorAlbedo(encodeTreeImpostorAlbedo(value))).toBeCloseTo(value, 6);
      expect(decodeTreeImpostorDepth(encodeTreeImpostorDepth(value))).toBeCloseTo(value, 6);
    }
    for (const value of [-1, -0.25, 0, 0.5, 1]) {
      expect(decodeTreeImpostorNormalComponent(encodeTreeImpostorNormalComponent(value))).toBeCloseTo(value, 6);
    }
  });

  it("uses a normal-depth shader with linear depth in alpha", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("vTreeImpostorLinearDepth");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("normalize(normal)");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("far - near");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("packedNormal");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorLinearDepth");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("gl_FragColor = vec4(packedNormal, vTreeImpostorLinearDepth)");
  });
});

function impostorSettings(): TreeSettings {
  const settings = cloneTreeSettings();
  settings.impostors = {
    ...settings.impostors,
    enabled: true,
    bakeOnStart: true,
    sourceLod: "mid",
    resolutionPx: 32,
    octahedralGridSize: 4,
    atlasPaddingPx: 1,
  };
  return settings;
}

function geometryMap(): TreeGeometryMap {
  const out = {} as TreeGeometryMap;
  for (const species of TREE_SPECIES) {
    const near = new THREE.BoxGeometry(1, 2, 1);
    const mid = new THREE.BoxGeometry(1, 2, 1);
    const far = new THREE.BoxGeometry(1, 2, 1);
    const impostor = new THREE.PlaneGeometry(1, 2);
    out[species] = {
      near,
      mid,
      far,
      impostor,
      variants: {
        0: { near, mid, far, impostor },
      },
    };
  }
  return out;
}

function fakeRenderTargetRenderer(options: { rejectShaderMaterial?: boolean } = {}): {
  renderCalls: number;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(viewport: THREE.Vector4): void;
  setViewport(x: number, y: number, width: number, height: number): void;
} {
  let currentTarget: THREE.WebGLRenderTarget | null = null;
  let clearColor = new THREE.Color(0x000000);
  let clearAlpha = 1;
  let viewport = new THREE.Vector4(0, 0, 1, 1);
  return {
    renderCalls: 0,
    render(scene) {
      if (options.rejectShaderMaterial) assertNoShaderMaterial(scene);
      this.renderCalls++;
    },
    setRenderTarget(target) {
      currentTarget = target;
    },
    getRenderTarget() {
      return currentTarget;
    },
    getClearColor(target) {
      return target.copy(clearColor);
    },
    getClearAlpha() {
      return clearAlpha;
    },
    setClearColor(color, alpha = clearAlpha) {
      clearColor = new THREE.Color(color);
      clearAlpha = alpha;
    },
    clear() {},
    getViewport(target) {
      return target.copy(viewport);
    },
    setViewport(...args: [THREE.Vector4] | [number, number, number, number]) {
      if (args.length === 1) viewport = args[0].clone();
      else viewport = new THREE.Vector4(args[0], args[1], args[2], args[3]);
    },
  };
}

function assertNoShaderMaterial(root: THREE.Object3D): void {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      if (item instanceof THREE.ShaderMaterial) throw new Error(`ShaderMaterial rejected: ${item.name}`);
    }
  });
}
