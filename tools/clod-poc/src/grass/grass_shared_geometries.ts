import * as THREE from "three";
import { grassRowsForSegments, type GrassSettings } from "./grass_config.js";
import {
  createBladeGeometry,
  createGrassBladeClumpGeometry,
  createGrassClumpGeometry,
  createGrassTuftGeometry,
} from "./grass_geometry.js";

export class GrassSharedGeometries {
  readonly classicBladeGeometry = createBladeGeometry();
  terrainPatchNearGeometry!: THREE.BufferGeometry;
  terrainPatchNearCrossedGeometry!: THREE.BufferGeometry;
  terrainPatchMidGeometry!: THREE.BufferGeometry;
  terrainPatchFarGeometry!: THREE.BufferGeometry;
  terrainPatchSuperGeometry!: THREE.BufferGeometry;
  ringNearGeometry!: THREE.BufferGeometry;
  ringMidGeometry!: THREE.BufferGeometry;
  ringFarGeometry!: THREE.BufferGeometry;
  ringSuperGeometry!: THREE.BufferGeometry;
  private key = "";

  rebuild(settings: GrassSettings): boolean {
    const key = grassGeometryKey(settings);
    if (key === this.key) return false;
    this.key = key;
    this.disposeRebuildable();

    const nearRows = grassRowsForSegments(settings.blade.nearSegments);
    const midRows = grassRowsForSegments(settings.blade.midSegments, 0);
    this.terrainPatchNearGeometry = createGrassClumpGeometry(
      settings.blade.nearBladesPerInstance,
      settings.blade.nearSegments,
      settings,
    );
    this.terrainPatchNearCrossedGeometry = createGrassBladeClumpGeometry(
      settings.blade.nearBladesPerInstance,
      nearRows,
      settings.seed + 0x9e3779b9,
    );
    this.terrainPatchMidGeometry = createGrassClumpGeometry(
      settings.blade.midBladesPerInstance,
      settings.blade.midSegments,
      settings,
    );
    this.terrainPatchFarGeometry = createGrassTuftGeometry(settings);
    this.terrainPatchSuperGeometry = createGrassTuftGeometry(
      settings.blade.farTuftWidthM * 1.45 / Math.max(settings.blade.widthM, 0.001),
    );
    this.ringNearGeometry = createGrassBladeClumpGeometry(settings.blade.nearBladesPerInstance, nearRows, 0x9e3779b9);
    this.ringMidGeometry = createGrassBladeClumpGeometry(settings.blade.midBladesPerInstance, midRows, 0x85ebca6b);
    this.ringFarGeometry = createGrassTuftGeometry(settings);
    this.ringSuperGeometry = createGrassTuftGeometry(
      settings.blade.farTuftWidthM * 1.45 / Math.max(settings.blade.widthM, 0.001),
    );
    return true;
  }

  dispose(): void {
    this.classicBladeGeometry.dispose();
    this.disposeRebuildable();
  }

  private disposeRebuildable(): void {
    this.terrainPatchNearGeometry?.dispose();
    this.terrainPatchNearCrossedGeometry?.dispose();
    this.terrainPatchMidGeometry?.dispose();
    this.terrainPatchFarGeometry?.dispose();
    this.terrainPatchSuperGeometry?.dispose();
    this.ringNearGeometry?.dispose();
    this.ringMidGeometry?.dispose();
    this.ringFarGeometry?.dispose();
    this.ringSuperGeometry?.dispose();
  }
}

export function grassGeometryKey(settings: GrassSettings): string {
  return [
    settings.seed,
    settings.blade.nearBladesPerInstance,
    settings.blade.midBladesPerInstance,
    settings.blade.nearSegments,
    settings.blade.midSegments,
    settings.blade.farTuftWidthM,
    settings.blade.widthM,
  ].join("|");
}
