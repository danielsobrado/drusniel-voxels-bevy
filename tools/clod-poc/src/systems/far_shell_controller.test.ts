import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFarShellController } from "./far_shell_controller.js";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";

const LIGHTING = {
  sunDirection: new THREE.Vector3(0.3, 0.8, 0.4).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.8),
  skyLight: new THREE.Color(0.5, 0.6, 0.8),
  groundLight: new THREE.Color(0.2, 0.18, 0.14),
};

function flatSummary(worldSize: number): TerrainSummaryField {
  const res = 4;
  const count = res * res;
  return {
    res,
    worldSize,
    farReduceFactor: worldSize / res,
    heightMin: new Float32Array(count),
    heightMax: new Float32Array(count),
    normalX: new Float32Array(count),
    normalY: new Float32Array(count).fill(1),
    normalZ: new Float32Array(count),
    coverage: new Float32Array(count).fill(1),
  };
}

describe("far shell controller", () => {
  it("moves the legacy far shell to the streaming camera center", () => {
    const scene = new THREE.Scene();
    const controller = createFarShellController({
      scene,
      terrainSummary: flatSummary(512),
      worldSizeCells: 512,
      isLongView: true,
      queryFarShell: true,
      queryCanopy: false,
      getLighting: () => LIGHTING,
      getSettings: () => ({
        enabled: true,
        radiusFactor: 3,
        heightBias: 0,
        heightDrop: 0,
      }),
    });

    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(mesh).toBeDefined();

    controller.moveTo(768, 640);

    expect(mesh!.position.x).toBeCloseTo(512);
    expect(mesh!.position.z).toBeCloseTo(384);
    controller.dispose();
  });
});
