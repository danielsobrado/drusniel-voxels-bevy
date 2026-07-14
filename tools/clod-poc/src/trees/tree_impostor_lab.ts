import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { float, texture, uv, vec3 } from "three/tsl";
import { TREE_SPECIES, type TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

type TreeImpostorLabChannel = "albedo" | "normal" | "depth";

export interface TreeImpostorLabStatus {
  mounted: boolean;
  species: TreeSpeciesId[];
  channels: TreeImpostorLabChannel[];
  position: [number, number, number];
  query: string;
}

declare global {
  interface Window {
    __drusnielTreeImpostorLab?: TreeImpostorLabStatus;
    __drusnielTreeImpostorAtlasRefs?: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  }
}

const LAB_QUERY = "treeImpostorLab";
const LAB_CHANNELS: readonly TreeImpostorLabChannel[] = ["albedo", "normal", "depth"];
const SPECIES_SPACING_M = 28;
const CHANNEL_SPACING_M = 9;
const PLANE_HEIGHT_M = 15;
const LABEL_HEIGHT_M = 1.8;

export function treeImpostorLabRequested(search = runtimeSearchParams()): boolean {
  const value = search.get(LAB_QUERY)?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function mountTreeImpostorLabFromWindow(
  scene: THREE.Scene,
  worldCells: number,
  search = runtimeSearchParams(),
): THREE.Group | null {
  if (!treeImpostorLabRequested(search)) return null;
  const atlases = typeof window === "undefined" ? undefined : window.__drusnielTreeImpostorAtlasRefs;
  if (!atlases) return null;
  return mountTreeImpostorLab(scene, atlases, worldCells, search);
}

export function mountTreeImpostorLab(
  scene: THREE.Scene,
  atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>,
  worldCells: number,
  search = runtimeSearchParams(),
): THREE.Group | null {
  const available = TREE_SPECIES.filter((species) => atlases[species]?.ready);
  if (available.length === 0) return null;

  const group = new THREE.Group();
  group.name = "tree-impostor-atlas-lab";
  const position = labPosition(worldCells, search);
  group.position.set(position[0], position[1], position[2]);
  const firstX = -((available.length - 1) * SPECIES_SPACING_M) * 0.5;

  for (let speciesIndex = 0; speciesIndex < available.length; speciesIndex++) {
    const species = available[speciesIndex] as TreeSpeciesId;
    const atlas = atlases[species];
    if (!atlas) continue;
    const speciesX = firstX + speciesIndex * SPECIES_SPACING_M;
    const aspect = Math.max(0.1, (atlas.atlasWidthPx ?? atlas.atlasSizePx) / (atlas.atlasHeightPx ?? atlas.atlasSizePx));
    const planeWidth = PLANE_HEIGHT_M * aspect;

    for (let channelIndex = 0; channelIndex < LAB_CHANNELS.length; channelIndex++) {
      const channel = LAB_CHANNELS[channelIndex] as TreeImpostorLabChannel;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, PLANE_HEIGHT_M),
        createLabMaterial(atlas, channel),
      );
      plane.name = `tree-impostor-lab:${species}:${channel}`;
      plane.position.set(speciesX + (channelIndex - 1) * CHANNEL_SPACING_M, PLANE_HEIGHT_M * 0.5, 0);
      plane.frustumCulled = false;
      group.add(plane);
    }

    const label = createLabel(`${species.toUpperCase()}  ${atlas.gridSize}x${atlas.gridSize}  ${atlas.resolutionPx}px`,
      `ALBEDO          NORMAL          DEPTH   variants=${Math.max(1, atlas.variantCount ?? 1)}`);
    label.position.set(speciesX, PLANE_HEIGHT_M + LABEL_HEIGHT_M * 0.7, 0.02);
    group.add(label);
  }

  scene.add(group);
  publishLabStatus(available, position);
  return group;
}

export function disposeTreeImpostorLab(group: THREE.Group | null): void {
  if (!group) return;
  group.removeFromParent();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  if (typeof window !== "undefined") window.__drusnielTreeImpostorLab = undefined;
}

function createLabMaterial(atlas: TreeImpostorAtlas, channel: TreeImpostorLabChannel): THREE.Material {
  const source = channel === "albedo" ? atlas.albedo ?? atlas.texture : atlas.normalDepth;
  if (!source) return new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide });
  const material = new MeshBasicNodeMaterial();
  const sample: TslNode = texture(source, uv() as never);
  if (channel === "albedo") {
    const coverage: TslNode = sample.w;
    const encoded: TslNode = sample.rgb.div(coverage.max(float(0.0001))).clamp(0, 1);
    material.colorNode = encoded.mul(encoded);
    material.opacityNode = coverage;
    (material as unknown as { maskNode: TslNode }).maskNode = coverage.greaterThan(0.001);
  } else if (channel === "normal") {
    material.colorNode = sample.rgb;
  } else {
    material.colorNode = vec3(sample.w);
  }
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

function createLabel(title: string, subtitle: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(10, 14, 18, 0.92)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#eef5f7";
    context.font = "600 42px system-ui, sans-serif";
    context.fillText(title, 20, 60);
    context.fillStyle = "#9fb4bd";
    context.font = "400 27px ui-monospace, monospace";
    context.fillText(subtitle, 20, 120);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(24, LABEL_HEIGHT_M, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function labPosition(worldCells: number, search: URLSearchParams): [number, number, number] {
  const center = Number.isFinite(worldCells) ? worldCells * 0.5 : 0;
  return [
    finiteParam(search, "treeLabX", center),
    finiteParam(search, "treeLabY", 72),
    finiteParam(search, "treeLabZ", center),
  ];
}

function finiteParam(search: URLSearchParams, name: string, fallback: number): number {
  const value = Number(search.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function publishLabStatus(species: TreeSpeciesId[], position: [number, number, number]): void {
  if (typeof window === "undefined") return;
  window.__drusnielTreeImpostorLab = {
    mounted: true,
    species,
    channels: [...LAB_CHANNELS],
    position,
    query: `?${LAB_QUERY}=1&treeLabX=${position[0]}&treeLabY=${position[1]}&treeLabZ=${position[2]}`,
  };
}

function runtimeSearchParams(): URLSearchParams {
  return typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
}
