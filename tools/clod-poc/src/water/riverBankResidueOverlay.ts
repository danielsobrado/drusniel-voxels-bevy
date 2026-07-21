import { disposeAfterGpuIdle } from "../rendering/deferred_gpu_dispose.js";
import * as THREE from "three";
import type { EnvironmentQuery } from "../environment_query/types.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";
import type { WaterField } from "./waterField.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";
import {
  RiverDressingSampleReader,
  type RiverDressingSamplingStats,
} from "./riverDressingSampleReader.js";
import {
  createRiverBankResidueBuildJob,
  type ResidueGeometry,
  type RiverBankResidueBuildJob,
} from "./riverBankResidueBuild.js";

export {
  createRiverBankResidueBuildJob,
  type RiverBankResidueBuildJob,
  type RiverBankResidueBuildResult,
  type RiverBankResidueSampler,
} from "./riverBankResidueBuild.js";

export interface RiverBankResidueOverlayOptions {
  readonly minimumSampleHintM?: number;
  readonly readEnvironmentQuery?: () => EnvironmentQuery | null;
}

const UPDATE_INTERVAL_S = 0.28;
const MIN_CAMERA_MOVE_M = 2.5;

export class RiverBankResidueOverlay {
  private readonly group = new THREE.Group();
  private readonly wetDecals = makeDecalMesh("river-bank-wetness-decals", 0.48);
  private readonly foamDecals = makeDecalMesh("river-bank-foam-residue", 0.58);
  private readonly settings = readRiverMaterialSettings();
  private readonly sampleReader: RiverDressingSampleReader;
  private elapsed = UPDATE_INTERVAL_S;
  private lastCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  private activeBuild: RiverBankResidueBuildJob | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    field: WaterField,
    options: RiverBankResidueOverlayOptions = {},
  ) {
    this.sampleReader = new RiverDressingSampleReader(field, {
      ...(options.minimumSampleHintM !== undefined
        ? { sampleHintM: options.minimumSampleHintM }
        : {}),
      ...(options.readEnvironmentQuery
        ? { readEnvironmentQuery: options.readEnvironmentQuery }
        : {}),
    });
    this.group.name = "river-bank-residue-overlay";
    this.group.add(this.wetDecals, this.foamDecals);
    this.scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getSamplingStats(): RiverDressingSamplingStats {
    return this.sampleReader.getStats();
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.group.visible) return;
    this.elapsed += deltaSeconds;
    if (this.activeBuild) {
      this.finishBuildStep();
      return;
    }

    const moved = Math.hypot(
      cameraPosition.x - this.lastCenter.x,
      cameraPosition.z - this.lastCenter.z,
    );
    if (this.elapsed < UPDATE_INTERVAL_S && moved < MIN_CAMERA_MOVE_M) return;
    this.elapsed = 0;
    this.lastCenter.copy(cameraPosition);
    this.activeBuild = createRiverBankResidueBuildJob(
      this.sampleReader,
      this.settings,
      cameraPosition.x,
      cameraPosition.z,
    );
    this.finishBuildStep();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.wetDecals.geometry.dispose();
    this.foamDecals.geometry.dispose();
    (this.wetDecals.material as THREE.Material).dispose();
    (this.foamDecals.material as THREE.Material).dispose();
  }

  private finishBuildStep(): void {
    const result = this.activeBuild?.step() ?? null;
    if (!result) return;
    replaceDecals(this.wetDecals, result.wet);
    replaceDecals(this.foamDecals, result.foam);
    this.activeBuild = null;
  }
}

function makeDecalMesh(name: string, opacity: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
  const material = trackedMeshBasicMaterial({
    transparent: true,
    opacity,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
  }, `river-bank-residue:${name}`);
  material.name = name;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

function replaceDecals(mesh: THREE.Mesh, geometry: ResidueGeometry): void {
  // This runs from the frame loop, so the previous geometry's buffers can still be
  // referenced by the in-flight main render pass. Swap first, then release the old one
  // after the queue drains; disposing it inline raises "[Buffer] used in submit while
  // destroyed" against renderContext_1.
  const previous = mesh.geometry;
  mesh.geometry = new THREE.BufferGeometry();
  disposeAfterGpuIdle(() => previous.dispose());
  mesh.geometry.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
  mesh.geometry.setAttribute("color", new THREE.BufferAttribute(geometry.colors, 3));
  mesh.geometry.setDrawRange(0, geometry.drawCount);
  mesh.visible = geometry.drawCount > 0;
}
