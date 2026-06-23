// LV-3: Far terrain shadow proxy (~128 m – 3.2 km).
//
// Far terrain shadow proxy: a coarse grid whose vertex stage lifts to the
// heightfield via TSL positionNode; colorWrite/depthWrite/depthTest off make its main-pass
// cost vertex-only, while the shadow pass uses the standard depth material.
//
// ⚠ INERT IN clod-poc: this sandbox has NO shadow-casting THREE.Light and the terrain is an
// unlit MeshBasicNodeMaterial (no receiveShadow), so there is no shadow map for this proxy to
// cast into — it produces zero visible shadows here. It is kept as a faithful **Bevy-port
// reference** (Bevy has real CSM). Gated to the long-view scene in main.ts so it costs nothing
// elsewhere. Wiring real shadows in clod-poc would require a DirectionalLight + shadow map +
// shadow-receiving terrain material — out of scope for the sandbox.
//

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { positionLocal, vec2, vec3, texture } from "three/tsl";

export interface FarTerrainShadowProxyOptions {
  /** Grid resolution (vertices per axis). Default: 512 */
  grid: number;
}

export interface FarTerrainShadowProxy {
  mesh: THREE.Mesh;
  triangleCount: number;
  dispose: () => void;
}

const DEFAULT_OPTIONS: FarTerrainShadowProxyOptions = {
  grid: 512,
};

/**
 * Build the far terrain shadow proxy — coarse shadow grid pattern.
 *
 * A static grid (512² by default) whose vertex stage lifts to the heightfield
 * via TSL positionNode.  colorWrite=false, depthWrite=false, depthTest=false
 * make the main pass vertex-only; the shadow pass swaps in the depth material.
 * The real terrain keeps castShadow=false.
 *
 * @param heightTexture  GPU-sampleable r32float height texture from createHeightTexture()
 * @param worldSize      World extent in cell units (for UV mapping)
 */
export function buildFarTerrainShadowProxy(
  heightTexture: THREE.DataTexture,
  worldSize: number,
  options: Partial<FarTerrainShadowProxyOptions> = {},
): FarTerrainShadowProxy {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const GRID = opts.grid;
  const n = GRID + 1;

  // --- Geometry: flat grid at y=0, positions in world XZ ---
  // Corner-origin: [0, worldSize] matching the terrain summary space.
  // Shadow grids typically use centered coordinates; we adapt to corner-origin.
  const pos = new Float32Array(n * n * 3);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = (z * n + x) * 3;
      pos[i] = (x / GRID) * worldSize;
      pos[i + 1] = 0; // y=0; lifted by positionNode
      pos[i + 2] = (z / GRID) * worldSize;
    }
  }

  // Triangle indices — standard grid pattern
  const idx = new Uint32Array(GRID * GRID * 6);
  let w = 0;
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const a = z * n + x;
      idx[w++] = a;
      idx[w++] = a + n;
      idx[w++] = a + 1;
      idx[w++] = a + 1;
      idx[w++] = a + n;
      idx[w++] = a + n + 1;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  // --- Material: MeshStandardNodeMaterial with TSL positionNode ---
  // Shadow proxy: depth-only material, no colour output
  //
  // The height texture uses UV = worldXZ / worldSize + 0.5 (matching
  // Heightfield.uvFromWorld).  positionLocal.xz gives world XZ because the
  // geometry is built in world space (identity model transform).
  const mat = new MeshStandardNodeMaterial();

  // TSL: sample height from the r32float texture at the vertex XZ position
  // Corner-origin UV: worldXZ / worldSize (no +0.5 offset needed)
  const heightUv = vec2(
    positionLocal.x.div(worldSize),
    positionLocal.z.div(worldSize),
  );
  const sampledHeight = texture(heightTexture, heightUv).r;

  // Lift vertex to heightfield — sampleHeight at local XZ
  const lifted = vec3(
    positionLocal.x,
    sampledHeight,
    positionLocal.z,
  );

  mat.positionNode = lifted;
  // Shadow pass uses the same lifted position
  (mat as unknown as { castShadowPositionNode: unknown }).castShadowPositionNode = lifted;

  // Main pass is vertex-only: no color, no depth writes, no depth test
  // Shadow proxy material: depth-only, no colour output
  mat.colorWrite = false;
  mat.depthWrite = false;
  mat.depthTest = false;

  // --- Mesh: cast shadows, don't receive ---
  // Shadow proxy: vertex-only pass, depth material for shadow map
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  return {
    mesh,
    triangleCount: GRID * GRID * 2,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
