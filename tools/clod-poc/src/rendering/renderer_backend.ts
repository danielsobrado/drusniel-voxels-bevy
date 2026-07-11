// Renderer-backend selection for the real app. The app selects a backend with
// `?renderer=webgpu|webgl` (default webgpu) and creates the matching renderer here, so the
// rest of main.ts depends on a small surface (renderer + maxAnisotropy) instead of
// `new THREE.WebGLRenderer` directly.

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { buildRequiredLimits, describeDiagnostics, probeWebGPU } from "../core/diagnostics.js";
import { installTerrainTextureArrayProbe } from "../gpu/terrain_texture_array_probe.js";
import { installMaterialKeyMemo } from "./three_patches.js";
import { installPositionInvariance } from "./veg_prepass.js";

export type RendererBackend = "webgl" | "webgpu";

const WEBGPU_SHADER_MATERIAL_GUARD_KEY = "__drusnielWebGpuShaderMaterialGuard";
const WEBGPU_SHADER_MATERIAL_FALLBACK_KEY = "__drusnielWebGpuShaderMaterialFallback";

export function parseRendererBackend(params: URLSearchParams): RendererBackend {
  return params.get("renderer") === "webgl" ? "webgl" : "webgpu";
}

export interface WebGlAppRenderer {
  isWebGpu: false;
  renderer: THREE.WebGLRenderer;
  /** Max texture anisotropy for this backend (queried on WebGL). */
  maxAnisotropy: number;
}

export interface WebGpuAppRenderer {
  isWebGpu: true;
  renderer: WebGPURenderer;
  maxAnisotropy: number;
}

export type AppRenderer = WebGlAppRenderer | WebGpuAppRenderer;

export function createWebGlAppRenderer(): WebGlAppRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  installTerrainTextureArrayProbe(renderer);
  return { isWebGpu: false, renderer, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() };
}

export async function createWebGpuAppRenderer(): Promise<WebGpuAppRenderer> {
  const diagnostics = await probeWebGPU();
  if (!diagnostics.ok) {
    throw new Error([
      diagnostics.reason ?? "WebGPU probe failed.",
      "Try a hard browser restart or add ?renderer=webgl while the D3D12 device is recovering.",
    ].join("\n"));
  }

  const renderer = new WebGPURenderer({
    antialias: true,
    // The application does not consume or resolve Three's timestamp pools.
    // Enabling them therefore leaks query pairs until the pool overflows.
    trackTimestamp: false,
    requiredLimits: buildRequiredLimits(diagnostics),
  });
  try {
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error([
      `WebGPU renderer init failed: ${message}`,
      "This usually means Chrome/Dawn is still holding a removed D3D12 device after a GPU hang.",
      "Close all tabs using this app, restart the browser if needed, or use ?renderer=webgl to recover the page.",
      ...describeDiagnostics(diagnostics),
    ].join("\n"));
  }
  installWebGpuShaderMaterialGuard();
  installPositionInvariance(renderer);
  installMaterialKeyMemo(renderer);
  installTerrainTextureArrayProbe(renderer);
  renderer.shadowMap.enabled = true;
  // fail-loud: surface WebGPU validation errors instead of silent black frames.
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  if (device) {
    let reported = 0;
    device.onuncapturederror = (e: GPUUncapturedErrorEvent): void => {
      if (reported++ < 8) console.error("[webgpu] uncaptured error:", e.error.message);
    };
    void device.lost.then((info) => {
      console.error("[webgpu] device lost:", info.reason, info.message);
      if (window.__drusnielClod) {
        window.__drusnielClod.error = `WebGPU device lost: ${info.reason || "unknown"}\n${info.message}`;
      }
    });
  }
  // WebGPU exposes a high anisotropy limit; 16 matches typical hardware and the WebGL default.
  return { isWebGpu: true, renderer, maxAnisotropy: 16 };
}

function installWebGpuShaderMaterialGuard(): void {
  const proto = THREE.Object3D.prototype as THREE.Object3D & {
    [WEBGPU_SHADER_MATERIAL_GUARD_KEY]?: boolean;
    add: THREE.Object3D["add"];
  };
  if (proto[WEBGPU_SHADER_MATERIAL_GUARD_KEY] === true) return;
  proto[WEBGPU_SHADER_MATERIAL_GUARD_KEY] = true;
  const originalAdd = proto.add;
  proto.add = function guardedAdd(this: THREE.Object3D, ...objects: THREE.Object3D[]): THREE.Object3D {
    for (const object of objects) replaceLegacyShaderMaterials(object);
    const result = originalAdd.apply(this, objects) as THREE.Object3D;
    for (const object of objects) replaceLegacyShaderMaterials(object);
    return result;
  } as THREE.Object3D["add"];
}

function replaceLegacyShaderMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    if (!mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => webGpuCompatibleMaterial(material));
    } else {
      mesh.material = webGpuCompatibleMaterial(mesh.material);
    }
  });
}

function webGpuCompatibleMaterial(material: THREE.Material): THREE.Material {
  const maybeShader = material as THREE.Material & {
    isShaderMaterial?: boolean;
    isRawShaderMaterial?: boolean;
    uniforms?: Record<string, { value: unknown }>;
  };
  if (!maybeShader.isShaderMaterial && !maybeShader.isRawShaderMaterial) return material;
  const cached = material.userData[WEBGPU_SHADER_MATERIAL_FALLBACK_KEY] as THREE.Material | undefined;
  if (cached) return cached;
  const fallback = new THREE.MeshBasicMaterial({
    color: colorFromShaderUniform(maybeShader.uniforms?.uColor?.value) ?? 0xffffff,
    transparent: material.transparent,
    opacity: material.opacity,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    side: material.side,
    wireframe: (material as THREE.Material & { wireframe?: boolean }).wireframe === true,
    toneMapped: material.toneMapped,
  });
  fallback.name = `${material.name || material.type || "shader"}-webgpu-fallback`;
  fallback.userData.sourceMaterialType = material.type;
  material.userData[WEBGPU_SHADER_MATERIAL_FALLBACK_KEY] = fallback;
  console.warn(`[webgpu] replaced incompatible ${material.type || "ShaderMaterial"} with MeshBasicMaterial fallback: ${material.name || "unnamed"}`);
  return fallback;
}

function colorFromShaderUniform(value: unknown): THREE.Color | undefined {
  if (value instanceof THREE.Color) return value.clone();
  if (typeof value === "number") return new THREE.Color(value);
  return undefined;
}
