import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installConstructionCommitGuard } from "./construction_commit_guard.js";
import type { ConstructionPlacementConfig } from "./types.js";

const placement: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 1,
  overlapPaddingM: 0.04,
  overlapSpatialCellM: 4,
  storageKey: "test",
};

class FakeDomElement {
  private listener: ((event: PointerEvent) => void) | null = null;

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    };
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "pointerdown" && typeof listener === "function") {
      this.listener = listener as (event: PointerEvent) => void;
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "pointerdown" && this.listener === listener) this.listener = null;
  }

  dispatch(event: PointerEvent): void {
    this.listener?.(event);
  }
}

function pointerEvent(button: number): PointerEvent & {
  readonly prevented: boolean;
  readonly stopped: boolean;
} {
  let prevented = false;
  let stopped = false;
  return {
    button,
    clientX: 50,
    clientY: 50,
    get prevented() { return prevented; },
    get stopped() { return stopped; },
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; },
  } as unknown as PointerEvent & { readonly prevented: boolean; readonly stopped: boolean };
}

function sceneFixture(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  scene.add(camera);
  const root = new THREE.Group();
  root.name = "construction-root";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = "construction-floor";
  root.add(mesh);
  scene.add(root);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return { scene, camera };
}

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("construction commit guard", () => {
  it("blocks a right-click removal outside the live authority radius", () => {
    const dom = new FakeDomElement();
    const { camera } = sceneFixture();
    const recordEditDenial = vi.fn();
    dispose = installConstructionCommitGuard({
      domElement: dom as unknown as HTMLElement,
      camera,
      worldCells: 100,
      placement,
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 4,
        buildPreviewRadiusM: 20,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => ({ x: 20, z: 0 }),
      getCounters: () => null,
      getInteractionMode: () => "playing",
      getTerrainRevision: () => 1,
      constructionReadyAt: () => true,
      recordEditDenial,
    });

    const event = pointerEvent(2);
    dom.dispatch(event);

    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(recordEditDenial).toHaveBeenCalledWith("out_of_range");
  });

  it("allows a right-click removal that is current, ready, and in range", () => {
    const dom = new FakeDomElement();
    const { camera } = sceneFixture();
    dispose = installConstructionCommitGuard({
      domElement: dom as unknown as HTMLElement,
      camera,
      worldCells: 100,
      placement,
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 4,
        buildPreviewRadiusM: 20,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => ({ x: 0, z: 0 }),
      getCounters: () => null,
      getInteractionMode: () => "playing",
      getTerrainRevision: () => 1,
      constructionReadyAt: () => true,
    });

    const event = pointerEvent(2);
    dom.dispatch(event);

    expect(event.prevented).toBe(false);
    expect(event.stopped).toBe(false);
  });
});
