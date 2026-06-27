// Volumetric god rays for the WebGPU post-process pipeline.
//
// Unlike the screen-space modes, this raymarches a real shadow map and therefore renders physically
// plausible shafts that scatter behind hills. three's GodraysNode needs a shadow-casting light with a
// populated shadow map, which the main clod-poc scene does not otherwise have (it uses the custom sky
// environment + shadow-proxy systems). So this controller lazily stands up its own directional light
// + shadow map and toggles the renderer's shadow map only while volumetric mode is active. It is the
// most expensive mode by design and is fully opt-in.

import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { godrays } from "three/examples/jsm/tsl/display/GodraysNode.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface VolumetricGodRaysOptions {
  scene: THREE.Scene;
  renderer: WebGPURenderer;
  /** Returns the current (normalized) direction from the world toward the sun. */
  getSunDirection: () => THREE.Vector3;
  /** Returns the world-space point the shadow coverage should center on (camera target/position). */
  getFocus: () => THREE.Vector3;
  /** Half-extent (meters) of the orthographic shadow camera. Shafts are a near-field effect. */
  coverage?: number;
  /** Distance (meters) to place the light along the sun direction from the focus point. */
  distance?: number;
}

export class VolumetricGodRays {
  private readonly scene: THREE.Scene;
  private readonly renderer: WebGPURenderer;
  private readonly getSunDirection: () => THREE.Vector3;
  private readonly getFocus: () => THREE.Vector3;
  private readonly coverage: number;
  private readonly distance: number;

  private light: THREE.DirectionalLight | null = null;
  private godraysNode: TslNode | null = null;
  private active = false;
  private prevShadowMapEnabled = false;
  private readonly tmpFocus = new THREE.Vector3();

  constructor(options: VolumetricGodRaysOptions) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.getSunDirection = options.getSunDirection;
    this.getFocus = options.getFocus;
    this.coverage = options.coverage ?? 350;
    this.distance = options.distance ?? 600;
  }

  private ensureLight(): THREE.DirectionalLight {
    if (this.light) return this.light;
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const cam = light.shadow.camera;
    cam.near = 1;
    cam.far = this.distance * 2;
    cam.left = -this.coverage;
    cam.right = this.coverage;
    cam.top = this.coverage;
    cam.bottom = -this.coverage;
    cam.updateProjectionMatrix();
    light.target = new THREE.Object3D();
    this.scene.add(light);
    this.scene.add(light.target);
    this.light = light;
    return light;
  }

  /**
   * Builds (once) the volumetric god-rays texture node bound to the scene depth and camera. Returns
   * a vec4 texture node suitable for screen-blending onto the graded scene colour.
   */
  buildTextureNode(depthTextureNode: TslNode, camera: THREE.Camera): TslNode {
    if (this.godraysNode) return this.godraysNode.getTextureNode();
    const light = this.ensureLight();
    this.godraysNode = godrays(depthTextureNode, camera, light);
    return this.godraysNode.getTextureNode();
  }

  /** Enables/disables the directional light + renderer shadow map for volumetric rendering. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.prevShadowMapEnabled = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = true;
      this.ensureLight().visible = true;
    } else {
      if (this.light) this.light.visible = false;
      this.renderer.shadowMap.enabled = this.prevShadowMapEnabled;
    }
  }

  /** Per-frame: place the light along the sun direction over the focus point. No-op when inactive. */
  update(): void {
    if (!this.active || !this.light) return;
    const focus = this.tmpFocus.copy(this.getFocus());
    const sun = this.getSunDirection();
    this.light.position.copy(focus).addScaledVector(sun, this.distance);
    this.light.target.position.copy(focus);
    this.light.target.updateMatrixWorld();
    // Streaming terrain/veg meshes are created over time; opt them into shadows while active.
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  dispose(): void {
    if (this.light) {
      this.scene.remove(this.light);
      this.scene.remove(this.light.target);
      this.light.dispose();
      this.light = null;
    }
    if (this.godraysNode) {
      this.godraysNode.dispose();
      this.godraysNode = null;
    }
  }
}
