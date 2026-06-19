// Instanced stone overlay. Mirrors GrassSystem: scatter deterministic instances over the
// LOD0 page footprints, batch them into THREE.InstancedMesh by (preset, variant), and pick a
// per-instance mesh LOD by camera distance. Stones are a pure visual overlay — they are added
// to the scene after the page build and never feed source_mesh.ts / weld.ts.

import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import { buildRock } from "./rock_builder.js";
import { hashCombine, hashString, Rng } from "./seed.js";
import { STONE_CLASSES, type StoneClass, type StoneSettings } from "./stone_config.js";
import { generateRankedStoneInstances, type RankedStoneInstance, type StoneInstance } from "./stone_scatter.js";

const VERTEX_SHADER = /* glsl */ `
  attribute vec4 vdata;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vData;
  void main() {
    vData = vdata;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vData;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;

    // Base rock tones, banded by strata (vData.y) and per-rock hue jitter from position.
    float hue = hash(floor(vWorldPos.xz * 0.5));
    vec3 lightStone = vec3(0.52, 0.5, 0.47);
    vec3 darkStone = vec3(0.3, 0.29, 0.28);
    vec3 rock = mix(darkStone, lightStone, smoothstep(0.0, 1.0, vData.y));
    rock = mix(rock, rock * vec3(1.05, 0.98, 0.9), hue * 0.5);

    // Grain + strata line darkening.
    float grain = hash(floor(vWorldPos.xz * 7.0 + vWorldPos.y));
    rock *= 0.9 + grain * 0.15;

    // Dust collects on up-facing surfaces; moss/lichen in cavities + upward openness.
    float up = clamp(n.y, 0.0, 1.0);
    vec3 dust = vec3(0.6, 0.55, 0.47);
    rock = mix(rock, dust, up * 0.18);
    float moss = clamp(vData.z, 0.0, 1.0) * up;
    rock = mix(rock, vec3(0.22, 0.3, 0.14), moss * 0.25);
    // Dirt streaks on steep faces.
    rock = mix(rock, vec3(0.18, 0.15, 0.12), (1.0 - up) * 0.18);

    // Cavity AO from vData.w.
    float ao = clamp(vData.w, 0.0, 1.0);

    vec3 lightDir = normalize(uLight);
    float sun = max(dot(n, lightDir), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * sun;
    gl_FragColor = vec4(rock * (hemi + direct) * ao, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface StoneLighting {
  light: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface StoneSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: StoneSettings;
  lighting: StoneLighting;
  material?: THREE.Material;
}

export interface StoneStats {
  total: number;
  large: number;
  medium: number;
  small: number;
  visible: number;
  drawnNear: number;
  drawnFar: number;
  groups: number;
}

interface LodMesh {
  detail: number;
  mesh: THREE.InstancedMesh;
}

interface StoneGroup {
  classId: StoneClass;
  instances: StoneInstance[];
  lods: LodMesh[]; // near → far, matching class lodDetails
}

const REFRESH_DISTANCE = 8;

export class StoneSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly material: THREE.Material;
  private settings: StoneSettings;
  private groups: StoneGroup[] = [];
  private visibleClasses = new Set<StoneClass>(STONE_CLASSES);
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly lastCamera = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private stats: StoneStats = emptyStats();

  constructor(options: StoneSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.material =
      options.material ??
      new THREE.ShaderMaterial({
        uniforms: {
          uLight: { value: options.lighting.light.clone() },
          uSunColor: { value: options.lighting.sunColor.clone() },
          uSkyLight: { value: options.lighting.skyLight.clone() },
          uGroundLight: { value: options.lighting.groundLight.clone() },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.FrontSide,
      });
    this.root.name = "stones";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled) this.rebuild();
    else this.clear();
  }

  updateSettings(settings: Partial<StoneSettings>): void {
    Object.assign(this.settings, settings);
    if (this.settings.enabled) this.rebuild();
    else this.clear();
    this.root.visible = this.settings.enabled;
  }

  updateLighting(lighting: StoneLighting): void {
    const uniforms = (this.material as Partial<THREE.ShaderMaterial>).uniforms;
    if (!uniforms) return;
    uniforms.uLight.value.copy(lighting.light);
    uniforms.uSunColor.value.copy(lighting.sunColor);
    uniforms.uSkyLight.value.copy(lighting.skyLight);
    uniforms.uGroundLight.value.copy(lighting.groundLight);
  }

  /** Show only the given size classes (debug). */
  setVisibleClasses(classes: Iterable<StoneClass>): void {
    this.visibleClasses = new Set(classes);
    this.lastCamera.set(Number.POSITIVE_INFINITY, 0, 0); // force a refresh
  }

  rebuild(): void {
    this.clear();
    if (!this.settings.enabled) return;

    const instances = this.scatterAll();
    const byGroup = new Map<string, StoneInstance[]>();
    for (const instance of instances) {
      const key = `${instance.classId}:${instance.preset}:${instance.variant}`;
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(instance);
      else byGroup.set(key, [instance]);
    }

    for (const [key, bucket] of byGroup) {
      const [classText, preset, variantText] = key.split(":");
      const classId = classText as StoneClass;
      const variant = Number(variantText);
      const details = this.settings.classes[classId].lodDetails;
      // Same variant seed for every LOD level => consistent silhouette across detail levels.
      const variantSeed = hashCombine(this.settings.seedSalt >>> 0, hashString(`stone:${preset}:${variant}`));
      const lods: LodMesh[] = details.map((detail) => {
        const built = buildRock(preset as StoneInstance["preset"], new Rng(variantSeed), detail);
        const mesh = new THREE.InstancedMesh(built.geometry, this.material, bucket.length);
        mesh.count = 0;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        return { detail, mesh };
      });
      this.groups.push({ classId, instances: bucket, lods });
    }

    this.lastCamera.set(Number.POSITIVE_INFINITY, 0, 0);
    this.refreshStats();
  }

  /** Assign each instance to a LOD bucket by camera distance and write instance matrices. */
  update(center: THREE.Vector3): void {
    if (!this.settings.enabled) return;
    if (this.lastCamera.distanceTo(center) < REFRESH_DISTANCE) return;
    this.lastCamera.copy(center);

    let visible = 0;
    let drawnNear = 0;
    let drawnFar = 0;
    for (const group of this.groups) {
      const counts = group.lods.map(() => 0);
      const show = this.visibleClasses.has(group.classId);
      const classCfg = this.settings.classes[group.classId];
      const farStart = classCfg.maxDistance * 0.45;
      for (const instance of group.instances) {
        if (!show) continue;
        const distance = Math.hypot(center.x - instance.x, center.z - instance.z);
        if (distance > classCfg.maxDistance) continue;
        const lodIndex = group.lods.length > 1 && distance > farStart ? 1 : 0;
        const lod = group.lods[lodIndex];
        this.tmpPos.set(instance.x, instance.y, instance.z);
        this.tmpEuler.set(instance.leanX, instance.yaw, instance.leanZ, "XYZ");
        this.tmpQuat.setFromEuler(this.tmpEuler);
        this.tmpScale.setScalar(instance.scale);
        this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        lod.mesh.setMatrixAt(counts[lodIndex], this.tmpMatrix);
        counts[lodIndex]++;
        visible++;
        if (lodIndex === 0) drawnNear++;
        else drawnFar++;
      }
      group.lods.forEach((lod, index) => {
        lod.mesh.count = counts[index];
        lod.mesh.instanceMatrix.needsUpdate = true;
      });
    }
    this.stats.visible = visible;
    this.stats.drawnNear = drawnNear;
    this.stats.drawnFar = drawnFar;
  }

  getStats(): StoneStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
    this.material.dispose();
  }

  private scatterAll(): StoneInstance[] {
    const ranked: RankedStoneInstance[] = [];
    const limit = Math.max(0, Math.floor(this.settings.maxInstances));
    if (limit === 0) return [];
    for (const node of this.nodes) {
      const source = node.footprint;
      const footprint: PageFootprint = {
        minX: THREE.MathUtils.clamp(source.minX, 0, this.worldCells),
        minZ: THREE.MathUtils.clamp(source.minZ, 0, this.worldCells),
        maxX: THREE.MathUtils.clamp(source.maxX, 0, this.worldCells),
        maxZ: THREE.MathUtils.clamp(source.maxZ, 0, this.worldCells),
      };
      ranked.push(...generateRankedStoneInstances(footprint, this.settings));
    }
    ranked.sort((a, b) => a.priority - b.priority);
    return ranked.slice(0, limit).map((entry) => entry.instance);
  }

  private clear(): void {
    for (const group of this.groups) {
      for (const lod of group.lods) {
        this.root.remove(lod.mesh);
        lod.mesh.geometry.dispose();
        lod.mesh.dispose();
      }
    }
    this.groups = [];
    this.stats = emptyStats();
  }

  private refreshStats(): void {
    const stats = emptyStats();
    stats.groups = this.groups.length;
    for (const group of this.groups) {
      stats.total += group.instances.length;
      stats[group.classId] += group.instances.length;
    }
    this.stats = stats;
  }
}

function emptyStats(): StoneStats {
  return { total: 0, large: 0, medium: 0, small: 0, visible: 0, drawnNear: 0, drawnFar: 0, groups: 0 };
}
