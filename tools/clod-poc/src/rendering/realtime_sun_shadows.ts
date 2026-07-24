import * as THREE from "three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { WebGPURenderer } from "three/webgpu";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  sunDirectionFromAngles,
} from "../environment/environment.js";

export const REALTIME_SUN_SHADOW_CASTER_LAYER_BASE = 2;
export const REALTIME_SUN_SHADOW_CASTER_LAYER_COUNT = 4;
export const REALTIME_SUN_SHADOW_CASTER_LAYER = REALTIME_SUN_SHADOW_CASTER_LAYER_BASE;

const DEFAULT_SHADOW_MAP_SIZE = 2048;
const DEFAULT_CASCADE_COUNT = 4;
const DEFAULT_MAX_FAR_M = 320;
const DEFAULT_LIGHT_MARGIN_M = 96;
const DEFAULT_LIGHT_DISTANCE_M = 520;
const DEFAULT_SHADOW_OPACITY = 0.34;
const DEFAULT_SUN_INTENSITY = 1.0;
const SHADOW_BIAS = -0.00012;
const SHADOW_NORMAL_BIAS = 2.2;
const SHADOW_RADIUS = 1.15;
const RECEIVER_KEY = "__drusnielTerrainShadowReceiver";
const IS_RECEIVER_KEY = "__drusnielIsTerrainShadowReceiver";
const ADD_PATCH_KEY = "__drusnielTerrainShadowAddPatch";
const SUN_SHADOW_HANDLE_KEY = "__drusnielRealtimeSunShadows";

type ShadowCapableRenderer = (THREE.WebGLRenderer | WebGPURenderer) & {
  shadowMap: { enabled: boolean };
};

export interface RealtimeSunShadowOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: ShadowCapableRenderer;
  worldCells: number;
  searchParams: URLSearchParams;
  enabled?: boolean;
}

interface SunShadowDebugHandle {
  sun: THREE.DirectionalLight;
  csm: CSMShadowNode | null;
  refresh: () => void;
}

type MeshBeforeRender = THREE.Mesh["onBeforeRender"];

export function installRealtimeSunShadows(options: RealtimeSunShadowOptions): SunShadowDebugHandle | null {
  if (options.enabled === false || options.searchParams.get("sunShadows") === "0") return null;
  if (querySet(options.searchParams, "ablate").has("shadows")) return null;

  options.renderer.shadowMap.enabled = true;
  installTerrainReceiverAutoAttach();
  prepareTerrainReceivers(options.scene);

  const center = new THREE.Vector3(options.worldCells * 0.5, 0, options.worldCells * 0.5);
  const lighting = defaultLighting();
  const sun = new THREE.DirectionalLight(lighting.sunColor, DEFAULT_SUN_INTENSITY);
  sun.name = "clod-realtime-sun-shadow-light";
  sun.castShadow = true;
  sun.shadow.mapSize.set(DEFAULT_SHADOW_MAP_SIZE, DEFAULT_SHADOW_MAP_SIZE);
  sun.shadow.bias = SHADOW_BIAS;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
  sun.shadow.radius = SHADOW_RADIUS;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = DEFAULT_LIGHT_MARGIN_M + DEFAULT_MAX_FAR_M * 2.2;
  enableRealtimeSunShadowCasterLayer(sun.shadow.camera, 0);
  updateSunPose(sun, lighting.sunDirection, center);

  options.scene.add(sun.target);
  options.scene.add(sun);

  const csm = setupCsmSunShadows(sun, options.camera, options.searchParams);
  if (!csm) configureFallbackShadowCamera(sun, options.worldCells);

  const refresh = (): void => {
    if (!csm) {
      sun.shadow.camera.updateProjectionMatrix();
      enableRealtimeSunShadowCasterLayer(sun.shadow.camera, 0);
      return;
    }
    const csmCamera = (csm as unknown as { camera?: THREE.PerspectiveCamera | null }).camera;
    if (!csmCamera) return;
    if ((csmCamera as unknown as { view?: { enabled?: boolean } }).view?.enabled) {
      csmCamera.clearViewOffset();
    }
    csmCamera.updateProjectionMatrix();
    csm.updateFrustums();
    enableRealtimeSunShadowCasterLayers(getCascadeCamerasFromHandle({ sun, csm, refresh }));
  };

  window.addEventListener("resize", refresh);
  requestAnimationFrame(() => refreshUntilReady(csm, refresh));

  const debugHandle = { sun, csm, refresh };
  (window as unknown as { [SUN_SHADOW_HANDLE_KEY]?: SunShadowDebugHandle })[SUN_SHADOW_HANDLE_KEY] = debugHandle;
  enableRealtimeSunShadowCasterLayers(getCascadeCamerasFromHandle(debugHandle));
  return debugHandle;
}

export function realtimeSunShadowCasterLayer(cascadeIndex: number): number {
  return REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + clampInt(cascadeIndex, 0, REALTIME_SUN_SHADOW_CASTER_LAYER_COUNT - 1);
}

export function markAsRealtimeSunShadowCaster(object: THREE.Object3D, cascadeIndex = 0): void {
  const layer = realtimeSunShadowCasterLayer(cascadeIndex);
  object.layers.set(layer);
  object.traverse((child) => child.layers.set(layer));
}

export function enableRealtimeSunShadowCasterLayer(camera: THREE.Camera, cascadeIndex = 0): void {
  camera.layers.enable(realtimeSunShadowCasterLayer(cascadeIndex));
}

export function getRealtimeSunShadowCascadeCameras(): THREE.Camera[] {
  if (typeof window === "undefined") return [];
  const handle = (window as unknown as { [SUN_SHADOW_HANDLE_KEY]?: SunShadowDebugHandle })[SUN_SHADOW_HANDLE_KEY];
  return handle ? getCascadeCamerasFromHandle(handle) : [];
}

/** True when a realtime sun-shadow light is live (i.e. not disabled by `sunShadows=0`/ablation). */
export function realtimeSunShadowsInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { [SUN_SHADOW_HANDLE_KEY]?: SunShadowDebugHandle })[SUN_SHADOW_HANDLE_KEY]);
}

/** Live on/off for the realtime sun shadows (GUI toggle). */
export function setRealtimeSunShadowsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const handle = (window as unknown as { [SUN_SHADOW_HANDLE_KEY]?: SunShadowDebugHandle })[SUN_SHADOW_HANDLE_KEY];
  if (!handle) return;
  handle.sun.castShadow = enabled;
  handle.refresh();
}

function getCascadeCamerasFromHandle(handle: SunShadowDebugHandle): THREE.Camera[] {
  const csm = handle.csm as unknown as { lights?: Array<{ shadow?: { camera?: THREE.Camera } }> } | null | undefined;
  const cameras = csm?.lights?.map((light) => light.shadow?.camera).filter((camera): camera is THREE.Camera => !!camera) ?? [];
  if (cameras.length > 0) return cameras;
  return handle.sun.shadow.camera ? [handle.sun.shadow.camera] : [];
}

function enableRealtimeSunShadowCasterLayers(cameras: readonly THREE.Camera[]): void {
  for (let i = 0; i < cameras.length; i++) enableRealtimeSunShadowCasterLayer(cameras[i], i);
}

function setupCsmSunShadows(
  sun: THREE.DirectionalLight,
  camera: THREE.PerspectiveCamera,
  searchParams: URLSearchParams,
): CSMShadowNode | null {
  try {
    const cascades = clampInt(Number(searchParams.get("csmcasc") ?? DEFAULT_CASCADE_COUNT), 1, 4);
    const csm = new CSMShadowNode(sun, {
      cascades,
      maxFar: DEFAULT_MAX_FAR_M,
      mode: "practical",
      lightMargin: DEFAULT_LIGHT_MARGIN_M,
    });
    csm.fade = searchParams.get("csmfade") !== "0";
    (sun.shadow as unknown as { shadowNode?: unknown }).shadowNode = csm;
    void camera;
    return csm;
  } catch (error) {
    console.warn("[shadows] CSM unavailable; using single directional shadow map", error);
    return null;
  }
}

function refreshUntilReady(csm: CSMShadowNode | null, refresh: () => void): void {
  refresh();
  if (!csm) return;
  const firstCascadeLeft = (
    csm as unknown as { lights?: { shadow?: { camera?: { left?: number } } }[] }
  ).lights?.[0]?.shadow?.camera?.left;
  if (typeof firstCascadeLeft !== "number" || !Number.isFinite(firstCascadeLeft)) {
    requestAnimationFrame(() => refreshUntilReady(csm, refresh));
  }
}

function configureFallbackShadowCamera(sun: THREE.DirectionalLight, worldCells: number): void {
  const camera = sun.shadow.camera as THREE.OrthographicCamera;
  const extent = Math.max(DEFAULT_MAX_FAR_M, worldCells * 0.65);
  camera.left = -extent;
  camera.right = extent;
  camera.top = extent;
  camera.bottom = -extent;
  camera.near = 1;
  camera.far = DEFAULT_LIGHT_MARGIN_M + extent * 2.2;
  camera.updateProjectionMatrix();
  enableRealtimeSunShadowCasterLayer(camera, 0);
}

function updateSunPose(sun: THREE.DirectionalLight, sunDirection: THREE.Vector3, center: THREE.Vector3): void {
  const distance = Math.max(DEFAULT_LIGHT_DISTANCE_M, center.length() + DEFAULT_MAX_FAR_M);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDirection.clone().normalize(), distance);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}

function defaultLighting(): { sunDirection: THREE.Vector3; sunColor: THREE.Color } {
  return {
    sunDirection: sunDirectionFromAngles(
      DEFAULT_ENVIRONMENT_SETTINGS.sunAzimuthDeg,
      DEFAULT_ENVIRONMENT_SETTINGS.sunElevationDeg,
    ),
    sunColor: DEFAULT_ENVIRONMENT_COLORS.sun.clone().multiplyScalar(DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity),
  };
}

function installTerrainReceiverAutoAttach(): void {
  const proto = THREE.Object3D.prototype as THREE.Object3D & {
    [ADD_PATCH_KEY]?: boolean;
    add: THREE.Object3D["add"];
  };
  if (proto[ADD_PATCH_KEY] === true) return;
  proto[ADD_PATCH_KEY] = true;

  const originalAdd = proto.add;
  proto.add = function (this: THREE.Object3D, ...objects: THREE.Object3D[]): THREE.Object3D {
    const result = originalAdd.apply(this, objects) as THREE.Object3D;
    for (const object of objects) prepareTerrainReceivers(object);
    return result;
  } as THREE.Object3D["add"];
}

function prepareTerrainReceivers(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    attachTerrainShadowReceiver(object);
  });
}

function attachTerrainShadowReceiver(mesh: THREE.Mesh): void {
  if (mesh.userData[IS_RECEIVER_KEY] === true || mesh.userData[RECEIVER_KEY]) return;
  if (!isTerrainGeometry(mesh.geometry)) return;

  const material = new THREE.ShadowMaterial({ color: 0x000000, opacity: DEFAULT_SHADOW_OPACITY });
  material.transparent = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  const receiver = new THREE.Mesh(mesh.geometry, material);
  receiver.name = `${mesh.name || "terrain"}:shadow-receiver`;
  receiver.userData[IS_RECEIVER_KEY] = true;
  receiver.castShadow = false;
  receiver.receiveShadow = true;
  receiver.frustumCulled = false;
  receiver.renderOrder = mesh.renderOrder + 1;

  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData[RECEIVER_KEY] = receiver;
  patchGeometrySync(mesh);
  mesh.add(receiver);
}

function patchGeometrySync(mesh: THREE.Mesh): void {
  const previousOnBeforeRender: MeshBeforeRender = mesh.onBeforeRender;
  mesh.onBeforeRender = function (this: THREE.Mesh, ...args: Parameters<MeshBeforeRender>): void {
    const receiver = this.userData[RECEIVER_KEY] as THREE.Mesh | undefined;
    if (receiver && receiver.geometry !== this.geometry) receiver.geometry = this.geometry;
    previousOnBeforeRender.apply(this, args);
  };
}

function isTerrainGeometry(geometry: THREE.BufferGeometry | undefined): boolean {
  return Boolean(geometry?.getAttribute("paintSlots") && geometry.getAttribute("paintWeights"));
}

function querySet(searchParams: URLSearchParams, key: string): Set<string> {
  return new Set((searchParams.get(key) ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
