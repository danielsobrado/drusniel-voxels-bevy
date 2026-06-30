import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import {
  toneMappingModeToThree,
  type PostProcessSettings,
} from "../environment/postprocess.js";

const TERRAIN_NON_INDEXED_FALLBACK_KEY = "__drusnielWebGpuTerrainNonIndexedFallback";

type WebGpuTerrainFallbackGeometry = THREE.BufferGeometry & {
  [TERRAIN_NON_INDEXED_FALLBACK_KEY]?: boolean;
};

/** True when the post-process output graph must be recompiled. */
export function postProcessOutputGraphDirty(
  current: PostProcessSettings,
  settings: Partial<PostProcessSettings>,
): boolean {
  return (
    (settings.enabled !== undefined && settings.enabled !== current.enabled) ||
    (settings.debugMode !== undefined && settings.debugMode !== current.debugMode)
  );
}

function isSetIndexBufferError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("setIndexBuffer") && message.includes("GPUBuffer");
}

function isIndexedTerrainGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.index !== null
    && geometry.getAttribute("paintSlots") !== undefined
    && geometry.getAttribute("paintWeights") !== undefined;
}

function convertTerrainGeometryToNonIndexed(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return false;
  const fallbackGeometry = geometry as WebGpuTerrainFallbackGeometry;
  if (fallbackGeometry[TERRAIN_NON_INDEXED_FALLBACK_KEY] || !isIndexedTerrainGeometry(geometry)) return false;

  const replacement = geometry.toNonIndexed() as WebGpuTerrainFallbackGeometry;
  replacement.name = geometry.name ? `${geometry.name}-webgpu-nonindexed` : "clod-terrain-webgpu-nonindexed";
  replacement[TERRAIN_NON_INDEXED_FALLBACK_KEY] = true;
  mesh.geometry = replacement;
  geometry.dispose();
  return true;
}

function convertVisibleTerrainMeshesToNonIndexed(scene: THREE.Scene): number {
  let converted = 0;
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Mesh && convertTerrainGeometryToNonIndexed(object)) converted += 1;
  });
  return converted;
}

export class WebGpuPostProcessPipeline {
  private settings: Partial<PostProcessSettings> = {};

  constructor(
    private readonly renderer: WebGPURenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
  ) {
    console.warn("[webgpu] bloom postprocess disabled: Three WebGPU cannot safely sample its render target in this path yet");
    this.updateSettings(settings);
  }

  setSize(_width?: number, _height?: number): void {
    // WebGPU bloom postprocess is disabled; keep the method for renderer startup parity.
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.settings.toneMapping) this.renderer.toneMapping = toneMappingModeToThree(this.settings.toneMapping);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    try {
      this.renderer.render(scene, camera);
    } catch (error) {
      if (!isSetIndexBufferError(error)) throw error;
      const converted = convertVisibleTerrainMeshesToNonIndexed(scene);
      if (converted <= 0) throw error;
      console.warn(`[webgpu] converted ${converted} indexed terrain mesh(es) to non-indexed geometry after setIndexBuffer failure`);
      this.renderer.render(scene, camera);
    }
  }

  dispose(): void {
    // No GPU resources are allocated while the WebGPU bloom path is disabled.
  }
}
