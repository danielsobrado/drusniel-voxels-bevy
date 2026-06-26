import * as THREE from "three";
import type { NaadfPocConfig } from "./config.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { nearTableChunkKeys, isChunkInNearTable } from "./nearPageTable.js";
import { chunkKeyToWorldOrigin } from "./keys.js";
import { HASH_EMPTY } from "./constants.js";

export class NaadfDebugOverlay {
  private readonly scene: THREE.Scene;
  private readonly config: NaadfPocConfig;
  private readonly group: THREE.Group;

  constructor(scene: THREE.Scene, config: NaadfPocConfig) {
    this.scene = scene;
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = "naadf-debug";
    this.scene.add(this.group);
  }

  update(state: NaadfWorldState): void {
    this.clearGroup();
    if (!this.config.debug.enabled) return;

    if (this.config.debug.showStreamCenter) {
      this.addMarker(state.cameraX, 4, state.cameraZ, 0x00ff88);
    }
    if (this.config.debug.showPredictedStreamCenter) {
      this.addMarker(state.predictedX, 6, state.predictedZ, 0xff8800);
    }
    if (this.config.debug.showNearPageTable) {
      this.drawNearTable(state);
    }
    if (this.config.debug.showHashFallbackTiles) {
      this.drawHashFallback(state);
    }
    if (this.config.debug.showStaleSummaries) {
      this.drawStaleResidents(state);
    }
    if (this.config.debug.showEviction) {
      this.drawCoolingResidents(state);
    }
    if (this.config.debug.showFarClipmapRings) {
      this.drawFarRings(state);
    }
  }

  private clearGroup(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }
  }

  private addMarker(x: number, y: number, z: number, color: number): void {
    const geo = new THREE.SphereGeometry(8, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
  }

  private drawNearTable(state: NaadfWorldState): void {
    const chunkSize = state.config.world.chunkSizeCells;
    const keys = nearTableChunkKeys(state.nearTable);
    const positions: number[] = [];
    for (const key of keys) {
      const origin = chunkKeyToWorldOrigin(key, chunkSize);
      const x0 = origin.x;
      const z0 = origin.z;
      const x1 = x0 + chunkSize;
      const z1 = z0 + chunkSize;
      const y = 2;
      positions.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x4488ff });
    const lines = new THREE.LineSegments(geo, mat);
    this.group.add(lines);
  }

  private drawHashFallback(state: NaadfWorldState): void {
    const chunkSize = state.config.world.chunkSizeCells;
    const table = state.hashFallback;
    for (let slot = 0; slot < table.capacity; slot++) {
      if (table.keysX[slot] === HASH_EMPTY) continue;
      const key = { x: table.keysX[slot]!, z: table.keysZ[slot]! };
      if (isChunkInNearTable(state.nearTable, key)) continue;
      const origin = chunkKeyToWorldOrigin(key, chunkSize);
      this.addMarker(origin.x + chunkSize * 0.5, 3, origin.z + chunkSize * 0.5, 0xff44aa);
    }
  }

  private drawStaleResidents(state: NaadfWorldState): void {
    const chunkSize = state.config.world.chunkSizeCells;
    for (const entry of state.residents) {
      if (entry.state !== "stale") continue;
      const origin = chunkKeyToWorldOrigin(entry.key, chunkSize);
      this.addMarker(origin.x + chunkSize * 0.5, 5, origin.z + chunkSize * 0.5, 0xffff00);
    }
  }

  private drawCoolingResidents(state: NaadfWorldState): void {
    const chunkSize = state.config.world.chunkSizeCells;
    for (const entry of state.residents) {
      if (entry.coolingSinceMs === 0) continue;
      if (isChunkInNearTable(state.nearTable, entry.key)) continue;
      const origin = chunkKeyToWorldOrigin(entry.key, chunkSize);
      this.addMarker(origin.x + chunkSize * 0.5, 1, origin.z + chunkSize * 0.5, 0xff2222);
    }
  }

  private drawFarRings(state: NaadfWorldState): void {
    const cx = state.cameraX;
    const cz = state.cameraZ;
    const positions: number[] = [];
    for (const ring of state.config.farClipmap.rings) {
      const segments = 64;
      const r0 = ring.startM;
      const r1 = ring.endM;
      for (const r of [r0, r1]) {
        for (let i = 0; i < segments; i++) {
          const a0 = (i / segments) * Math.PI * 2;
          const a1 = ((i + 1) / segments) * Math.PI * 2;
          const y = 1;
          positions.push(
            cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r,
            cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r,
          );
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x88aaff });
    const lines = new THREE.LineSegments(geo, mat);
    this.group.add(lines);
  }

  dispose(): void {
    this.clearGroup();
    this.group.removeFromParent();
  }
}
