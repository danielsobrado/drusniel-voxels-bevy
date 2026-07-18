import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createLiveTreeImpostorMaterial,
  TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME,
  treeImpostorYawSinCosAttribute,
  writeTreeImpostorUvRectIfChanged,
  writeTreeImpostorYawSinCosIfChanged,
  type TreeImpostorAtlas,
  type TreeInstance,
} from "./index.js";
import { attachPackedTreeInstanceAttributes } from "./tree_system_instance_attribute_layout.js";

describe("CPU tree impostor normal space", () => {
  it("allocates an identity yaw basis only for impostor instances", () => {
    const impostorGeometry = geometry();
    attachPackedTreeInstanceAttributes(impostorGeometry, 2, true);
    const yaw = impostorGeometry.getAttribute(TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME);

    expect(yaw).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect([yaw.getX(0), yaw.getY(0), yaw.getX(1), yaw.getY(1)]).toEqual([1, 0, 1, 0]);

    const regularGeometry = geometry();
    attachPackedTreeInstanceAttributes(regularGeometry, 2, false);
    expect(regularGeometry.getAttribute(TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME)).toBeUndefined();
  });

  it("writes source-tree yaw as cosine and sine without redundant uploads", () => {
    const mesh = impostorMesh();

    expect(writeTreeImpostorYawSinCosIfChanged(mesh, 1, Math.PI * 0.5)).toBe(true);
    expect(writeTreeImpostorYawSinCosIfChanged(mesh, 1, Math.PI * 0.5)).toBe(false);

    const yaw = treeImpostorYawSinCosAttribute(mesh);
    expect(yaw.getX(1)).toBeCloseTo(0, 6);
    expect(yaw.getY(1)).toBeCloseTo(1, 6);
  });

  it("updates yaw through the normal CPU impostor UV write path", () => {
    const mesh = impostorMesh();
    const settings = cloneTreeSettings();
    const instance = {
      position: [0, 0, 0],
      species: "oak",
      variant: 0,
      rotationY: Math.PI,
    } as TreeInstance;

    expect(writeTreeImpostorUvRectIfChanged({
      mesh,
      index: 0,
      instance,
      cameraPosition: new THREE.Vector3(10, 0, 0),
      settings,
      impostorAtlases: {},
    })).toBe(true);

    const yaw = treeImpostorYawSinCosAttribute(mesh);
    expect(yaw.getX(0)).toBeCloseTo(-1, 6);
    expect(yaw.getY(0)).toBeCloseTo(0, 6);
  });

  it("rotates captured normals in classic single and blended shaders", () => {
    for (const viewBlend of [false, true]) {
      const impostorAtlas = atlas(true);
      const material = createLiveTreeImpostorMaterial(
        cloneTreeSettings(),
        impostorAtlas,
        { webgpu: false, viewBlend },
      ) as THREE.ShaderMaterial;

      expect(material.vertexShader).toContain(`attribute vec2 ${TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME}`);
      expect(material.vertexShader).toContain("vTreeImpostorYawSinCos = treeImpostorYawSinCos");
      expect(material.fragmentShader).toContain("localNormal.x * yawSinCos.x + localNormal.z * yawSinCos.y");
      expect(material.fragmentShader).toContain("localNormal.z * yawSinCos.x - localNormal.x * yawSinCos.y");
      expect(material.fragmentShader).toContain("vTreeImpostorYawSinCos, hasNormalDepthMap");
      material.dispose();
      impostorAtlas.dispose();
    }
  });

  it("builds WebGPU single and blended normal graphs with the yaw attribute", () => {
    for (const viewBlend of [false, true]) {
      const impostorAtlas = atlas(true);
      const material = createLiveTreeImpostorMaterial(
        cloneTreeSettings(),
        impostorAtlas,
        { webgpu: true, viewBlend },
      ) as THREE.Material & { normalNode?: unknown };

      expect(material.normalNode).toBeDefined();
      material.dispose();
      impostorAtlas.dispose();
    }
  });

  it("keeps billboard-normal fallback when captured normals are unavailable", () => {
    const impostorAtlas = atlas(false);
    const material = createLiveTreeImpostorMaterial(
      cloneTreeSettings(),
      impostorAtlas,
      { webgpu: false, viewBlend: false },
    ) as THREE.ShaderMaterial;

    expect(material.uniforms.hasNormalDepthMap.value).toBe(0);
    expect(material.fragmentShader).toContain("step(0.5, hasNormalMap)");
    material.dispose();
    impostorAtlas.dispose();
  });
});

function impostorMesh(): THREE.InstancedMesh {
  const result = geometry();
  attachPackedTreeInstanceAttributes(result, 2, true);
  return new THREE.InstancedMesh(result, new THREE.MeshBasicMaterial(), 2);
}

function geometry(): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  return result;
}

function atlas(withNormal: boolean): TreeImpostorAtlas {
  const albedo = texture([255, 255, 255, 255]);
  const normalDepth = withNormal ? texture([255, 128, 128, 255]) : undefined;
  return {
    species: "oak",
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      albedo.dispose();
      normalDepth?.dispose();
    },
  };
}

function texture(rgba: [number, number, number, number]): THREE.DataTexture {
  const result = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.needsUpdate = true;
  return result;
}
