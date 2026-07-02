import * as THREE from "three";
import type { ClodPageNode } from "./types.js";
import type { ClodAppState } from "./app/clod_app_state.js";
import { selectShadowCut, DEFAULT_SHADOW_CUT_PARAMS, type ShadowCutParams } from "./shadow_clod.js";
import { buildShadowManifest } from "./shadow_manifest.js";
import { buildShadowMeshSet } from "./shadow_mesh.js";
import { buildShadowOverlayModel, shadowPolicyColor, type ShadowOverlayMode } from "./shadow_overlay.js";
import { buildShadowProxyViewerModel, shadowProxyViewerSummaryLine, type ShadowProxyViewerMode } from "./shadow_proxy_overlay.js";
import {
  trackedLineBasicMaterial,
  trackedMeshBasicMaterial,
} from "./rendering/material_churn/tracked_material_factory.js";

export interface ClodShadowOverlayControllerDeps {
  roots: () => ClodPageNode[];
  camera: THREE.PerspectiveCamera;
  renderer: { domElement: HTMLCanvasElement };
  scene: THREE.Scene;
  state: ClodAppState;
  getSelectionCenter: () => THREE.Vector3;
  nearFieldRadius: () => number;
}

export interface ClodShadowOverlayController {
  update: () => void;
  dispose: () => void;
}

const OVERLAY_GROUP_NAME = "__clodShadowOverlay";
const CAMERA_REBUILD_THRESHOLD = 8;
const REBUILD_COOLDOWN_MS = 200;

function rootsSignature(roots: readonly ClodPageNode[]): string {
  let sig = `${roots.length}`;
  for (const r of roots) sig += `|${r.id}`;
  return sig;
}

export function createClodShadowOverlayController(
  deps: ClodShadowOverlayControllerDeps,
): ClodShadowOverlayController {
  const group = new THREE.Group();
  group.name = OVERLAY_GROUP_NAME;
  deps.scene.add(group);

  const proxyGroup = new THREE.Group();
  proxyGroup.name = "__clodShadowProxyMeshes";
  deps.scene.add(proxyGroup);

  const footprintMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const proxyMeshMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const proxyWireMaterial = trackedLineBasicMaterial({
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  }, "clod-shadow-proxy-wire");

  let lastOverlayMode: ShadowOverlayMode = "off";
  let lastProxyMode: ShadowProxyViewerMode = "off";
  let lastWireframe = true;
  const lastCamPos = new THREE.Vector3();
  let lastRebuildAt = 0;
  let lastRootsSig = "";

  function materialKey(color: number, opacity: number): string {
    return `${color.toString(16)}:${opacity.toFixed(3)}`;
  }

  function footprintMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = materialKey(color, opacity);
    const existing = footprintMaterials.get(key);
    if (existing) return existing;
    const material = trackedMeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }, `clod-shadow-footprint:${key}`);
    footprintMaterials.set(key, material);
    return material;
  }

  function proxyMeshMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = materialKey(color, opacity);
    const existing = proxyMeshMaterials.get(key);
    if (existing) return existing;
    const material = trackedMeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      wireframe: false,
      depthWrite: false,
    }, `clod-shadow-proxy:${key}`);
    proxyMeshMaterials.set(key, material);
    return material;
  }

  function clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const child = g.children[0]!;
      g.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
      }
    }
  }

  function rebuild(): void {
    clearGroup(group);
    clearGroup(proxyGroup);

    const state = deps.state;
    const overlayMode = state.clodShadowOverlayMode;
    const proxyMode = state.clodShadowProxyView;
    const wireframe = state.clodShadowProxyWireframe;

    if (overlayMode === "off" && proxyMode === "off") {
      state.clodShadowStatsLine = "";
      return;
    }

    const roots = deps.roots();
    lastRootsSig = rootsSignature(roots);
    if (roots.length === 0) return;

    const center = deps.getSelectionCenter();
    const viewportH = deps.renderer.domElement.height;
    const nearFieldR = deps.nearFieldRadius();

    const params: ShadowCutParams = {
      ...DEFAULT_SHADOW_CUT_PARAMS,
      viewportH,
      fovY: THREE.MathUtils.degToRad(deps.camera.fov),
      camPos: [deps.camera.position.x, deps.camera.position.y, deps.camera.position.z],
      nearField: {
        enabled: nearFieldR > 0,
        centerX: center.x,
        centerZ: center.z,
        radius: nearFieldR,
        boundaryPadding: 0,
      },
    };

    const cut = selectShadowCut(roots, params);
    const manifest = buildShadowManifest(roots, cut);

    if (overlayMode !== "off") {
      const overlay = buildShadowOverlayModel(manifest, { mode: overlayMode });
      for (const entry of overlay.entries) {
        const fp = entry.footprint;
        const w = fp.maxX - fp.minX;
        const d = fp.maxZ - fp.minZ;
        const cx = (fp.minX + fp.maxX) / 2;
        const cz = (fp.minZ + fp.maxZ) / 2;
        const cy = entry.bounds.center[1];
        const geo = new THREE.BoxGeometry(w, 0.5, d);
        const mat = footprintMaterial(shadowPolicyColor(entry.policy), entry.opacity * 0.45);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, cy + 0.25, cz);
        mesh.renderOrder = 22;
        mesh.name = `shadow-overlay:${entry.nodeId}`;
        group.add(mesh);
      }
    }

    if (proxyMode !== "off") {
      const meshSet = buildShadowMeshSet(roots, manifest, { preserveBoundary: false });
      const proxyModel = buildShadowProxyViewerModel(meshSet, {
        mode: proxyMode,
        wireframe,
        opacity: 0.55,
      });

      for (const entry of proxyModel.meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(entry.positions, 3));
        geo.setIndex(new THREE.Uint32BufferAttribute(entry.indices, 1));

        if (wireframe) {
          const edges = new THREE.EdgesGeometry(geo);
          geo.dispose();
          const line = new THREE.LineSegments(edges, proxyWireMaterial);
          line.renderOrder = 23;
          line.name = `shadow-proxy:${entry.nodeId}`;
          proxyGroup.add(line);
        } else {
          const mesh = new THREE.Mesh(geo, proxyMeshMaterial(entry.color, entry.opacity));
          mesh.renderOrder = 23;
          mesh.name = `shadow-proxy:${entry.nodeId}`;
          proxyGroup.add(mesh);
        }
      }

      state.clodShadowStatsLine = [
        overlayMode !== "off" ? `overlay: ${manifest.totals.casterPages} casters` : "",
        shadowProxyViewerSummaryLine(proxyModel.summary),
      ].filter(Boolean).join(" · ");
    } else if (overlayMode !== "off") {
      const overlay = buildShadowOverlayModel(manifest, { mode: overlayMode });
      state.clodShadowStatsLine = overlay.summary.policySummary;
    } else {
      state.clodShadowStatsLine = "";
    }

    lastCamPos.copy(deps.camera.position);
    lastRebuildAt = performance.now();
  }

  function update(): void {
    const state = deps.state;
    const overlayMode = state.clodShadowOverlayMode;
    const proxyMode = state.clodShadowProxyView;
    const wireframe = state.clodShadowProxyWireframe;

    const modeChanged = overlayMode !== lastOverlayMode || proxyMode !== lastProxyMode || wireframe !== lastWireframe;
    if (modeChanged) {
      lastOverlayMode = overlayMode;
      lastProxyMode = proxyMode;
      lastWireframe = wireframe;
      rebuild();
      return;
    }

    if (overlayMode === "off" && proxyMode === "off") return;

    const cam = deps.camera.position;
    const moved = cam.distanceTo(lastCamPos);
    const rootsChanged = rootsSignature(deps.roots()) !== lastRootsSig;
    const cooledDown = performance.now() - lastRebuildAt >= REBUILD_COOLDOWN_MS;
    if ((moved >= CAMERA_REBUILD_THRESHOLD || rootsChanged) && cooledDown) rebuild();
  }

  function dispose(): void {
    clearGroup(group);
    clearGroup(proxyGroup);
    deps.scene.remove(group);
    deps.scene.remove(proxyGroup);
    for (const material of footprintMaterials.values()) material.dispose();
    for (const material of proxyMeshMaterials.values()) material.dispose();
    proxyWireMaterial.dispose();
  }

  return { update, dispose };
}
