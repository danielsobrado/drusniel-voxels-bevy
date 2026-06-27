import * as THREE from "three";
import type { ClodPageNode } from "./types.js";
import type { ClodAppState } from "./app/clod_app_state.js";
import { selectShadowCut, DEFAULT_SHADOW_CUT_PARAMS, type ShadowCutParams } from "./shadow_clod.js";
import { buildShadowManifest } from "./shadow_manifest.js";
import { buildShadowMeshSet } from "./shadow_mesh.js";
import { buildShadowOverlayModel, shadowPolicyColor, type ShadowOverlayMode } from "./shadow_overlay.js";
import { buildShadowProxyViewerModel, shadowProxyViewerSummaryLine, type ShadowProxyViewerMode } from "./shadow_proxy_overlay.js";

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

/** Rebuild the overlay when the camera moves more than this many world units. */
const CAMERA_REBUILD_THRESHOLD = 8;
/** Minimum milliseconds between camera-move rebuilds to avoid thrashing. */
const REBUILD_COOLDOWN_MS = 200;

export function createClodShadowOverlayController(
  deps: ClodShadowOverlayControllerDeps,
): ClodShadowOverlayController {
  const group = new THREE.Group();
  group.name = OVERLAY_GROUP_NAME;
  deps.scene.add(group);

  const proxyGroup = new THREE.Group();
  proxyGroup.name = "__clodShadowProxyMeshes";
  deps.scene.add(proxyGroup);

  const footprintMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });

  const proxyWireMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });

  let lastOverlayMode: ShadowOverlayMode = "off";
  let lastProxyMode: ShadowProxyViewerMode = "off";
  let lastWireframe = true;
  let lastCamPos = new THREE.Vector3();
  let lastRebuildAt = 0;

  function clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const child = g.children[0]!;
      g.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
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
        const cy = (entry.bounds.center[1]);

        const geo = new THREE.BoxGeometry(w, 0.5, d);
        const color = shadowPolicyColor(entry.policy);
        const mat = footprintMaterial.clone();
        mat.color.setHex(color);
        mat.opacity = entry.opacity * 0.45;
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
          const line = new THREE.LineSegments(edges, proxyWireMaterial.clone());
          line.renderOrder = 23;
          line.name = `shadow-proxy:${entry.nodeId}`;
          proxyGroup.add(line);
        } else {
          const mat = new THREE.MeshBasicMaterial({
            color: entry.color,
            transparent: true,
            opacity: entry.opacity,
            side: THREE.DoubleSide,
            wireframe: false,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = 23;
          mesh.name = `shadow-proxy:${entry.nodeId}`;
          proxyGroup.add(mesh);
        }
      }

      state.clodShadowStatsLine = [
        overlayMode !== "off"
          ? `overlay: ${manifest.totals.casterPages} casters`
          : "",
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
    const cooledDown = performance.now() - lastRebuildAt >= REBUILD_COOLDOWN_MS;
    if (moved >= CAMERA_REBUILD_THRESHOLD && cooledDown) {
      rebuild();
    }
  }

  function dispose(): void {
    clearGroup(group);
    clearGroup(proxyGroup);
    deps.scene.remove(group);
    deps.scene.remove(proxyGroup);
    footprintMaterial.dispose();
    proxyWireMaterial.dispose();
  }

  return { update, dispose };
}
