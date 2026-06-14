import * as THREE from "three";
import { materialWeights, surfaceHeight, surfaceNormal } from "./terrain.js";
import type { ClodPageNode, PageFootprint } from "./types.js";

const TWO_PI = Math.PI * 2;
const MIN_GRASS_WEIGHT = 0.05;
const BLADE_ROWS = [
  [0, 1],
  [0.35, 0.75],
  [0.7, 0.4],
  [1, 0],
] as const;

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 wind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth, position.y * aHeight, position.z);
    localPosition.xz += wind;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(-wind.x * 0.35, bend * 0.16, 1.0 - wind.y * 0.35));
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    vWorldPos = aOffset + rotatedPosition;
    vUv = uv;
    vColorMix = aColorMix;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 darkGreen = vec3(0.035, 0.12, 0.025);
    vec3 midGreen = vec3(0.12, 0.34, 0.055);
    vec3 tipGreen = vec3(0.34, 0.56, 0.12);
    vec3 dryGrass = vec3(0.52, 0.42, 0.12);
    vec3 grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, vUv.y));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, vUv.y));
    grassColor = mix(grassColor, dryGrass, vColorMix * 0.58);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float back = max(dot(-n, lightDirection), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * pow(sun, 1.25);
    vec3 transmission = vec3(0.46, 0.55, 0.12) * back * (0.16 + vUv.y * 0.5);
    gl_FragColor = vec4(grassColor * (hemi + direct) + transmission * grassColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GrassSettings {
  enabled: boolean;
  distance: number;
  bladeSpacing: number;
  bladeHeight: number;
  bladeHeightVariation: number;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  slopeMinY: number;
  minHeight: number;
  maxHeight: number;
  maxBlades: number;
  seed: number;
}

export interface GrassLighting {
  light: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface GrassSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: GrassSettings;
  lighting: GrassLighting;
}

export interface GrassBladeInstance {
  offset: [number, number, number];
  height: number;
  rotationY: number;
  phase: number;
  colorMix: number;
}

export interface GrassCandidateSample {
  height: number;
  normalY: number;
  grassWeight: number;
  threshold: number;
}

interface GrassPatch {
  nodeId: string;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  centerX: number;
  centerZ: number;
  radius: number;
  bladeCount: number;
}

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
  distance: 96,
  bladeSpacing: 1.6,
  bladeHeight: 1.15,
  bladeHeightVariation: 0.75,
  bladeWidth: 0.08,
  windStrength: 0.32,
  windSpeed: 1.35,
  slopeMinY: 0.72,
  minHeight: 20,
  maxHeight: 86,
  maxBlades: 35000,
  seed: 1337,
};

export function hash2(x: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(x | 0, 0x27d4eb2d);
  value ^= Math.imul(z | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function randomSigned(x: number, z: number, seed: number): number {
  return hash2(x, z, seed) * 2 - 1;
}

export function acceptsGrassCandidate(settings: GrassSettings, sample: GrassCandidateSample): boolean {
  return sample.normalY >= settings.slopeMinY
    && sample.height >= settings.minHeight
    && sample.height <= settings.maxHeight
    && sample.grassWeight > MIN_GRASS_WEIGHT
    && sample.threshold < sample.grassWeight;
}

export function generateGrassInstances(
  footprint: PageFootprint,
  settings: GrassSettings,
  maxBlades = settings.maxBlades,
): GrassBladeInstance[] {
  const rankedInstances: { priority: number; instance: GrassBladeInstance }[] = [];
  const spacing = Math.max(0.05, settings.bladeSpacing);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(maxBlades));

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + randomSigned(gridX, gridZ, settings.seed + 101) * spacing * 0.34,
        footprint.minX + 0.001,
        footprint.maxX - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + randomSigned(gridX, gridZ, settings.seed + 211) * spacing * 0.34,
        footprint.minZ + 0.001,
        footprint.maxZ - 0.001,
      );
      const height = surfaceHeight(x, z);
      const normalY = surfaceNormal(x, z)[1];
      const grassWeight = materialWeights(height, normalY)[0];
      if (!acceptsGrassCandidate(settings, {
        height,
        normalY,
        grassWeight,
        threshold: hash2(gridX, gridZ, settings.seed + 307),
      })) continue;

      const heightScale = Math.max(
        0.1,
        1 + randomSigned(gridX, gridZ, settings.seed + 401) * settings.bladeHeightVariation,
      );
      rankedInstances.push({
        priority: hash2(gridX, gridZ, settings.seed + 809),
        instance: {
          offset: [x, height + 0.02, z],
          height: settings.bladeHeight * heightScale,
          rotationY: hash2(gridX, gridZ, settings.seed + 503) * TWO_PI,
          phase: hash2(gridX, gridZ, settings.seed + 601) * TWO_PI,
          colorMix: Math.pow(hash2(gridX, gridZ, settings.seed + 701), 2),
        },
      });
    }
  }
  rankedInstances.sort((a, b) => a.priority - b.priority);
  return rankedInstances.slice(0, limit).map(({ instance }) => instance);
}

function createBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [y, halfWidth] of BLADE_ROWS) {
    positions.push(-halfWidth, y, 0, halfWidth, y, 0);
    uvs.push(0, y, 1, y);
  }
  for (let row = 0; row < BLADE_ROWS.length - 1; row++) {
    const lower = row * 2;
    const upper = lower + 2;
    indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function createGrassMaterial(settings: GrassSettings, lighting: GrassLighting): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBladeWidth: { value: settings.bladeWidth },
      uWindStrength: { value: settings.windStrength },
      uWindSpeed: { value: settings.windSpeed },
      uLight: { value: lighting.light.clone() },
      uSunColor: { value: lighting.sunColor.clone() },
      uSkyLight: { value: lighting.skyLight.clone() },
      uGroundLight: { value: lighting.groundLight.clone() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    toneMapped: true,
  });
}

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly bladeGeometry = createBladeGeometry();
  private readonly material: THREE.ShaderMaterial;
  private settings: GrassSettings;
  private patches: GrassPatch[] = [];
  private bladeCount = 0;
  private readonly lastCenter: THREE.Vector3;

  constructor(options: GrassSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.material = createGrassMaterial(this.settings, options.lighting);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "grass";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled && this.patches.length === 0) this.refreshPatches(this.lastCenter);
  }

  updateSettings(settings: Partial<GrassSettings>): void {
    Object.assign(this.settings, settings);
    this.material.uniforms.uBladeWidth.value = this.settings.bladeWidth;
    this.material.uniforms.uWindStrength.value = this.settings.windStrength;
    this.material.uniforms.uWindSpeed.value = this.settings.windSpeed;
    this.setEnabled(this.settings.enabled);
  }

  updateLighting(lighting: GrassLighting): void {
    this.material.uniforms.uLight.value.copy(lighting.light);
    this.material.uniforms.uSunColor.value.copy(lighting.sunColor);
    this.material.uniforms.uSkyLight.value.copy(lighting.skyLight);
    this.material.uniforms.uGroundLight.value.copy(lighting.groundLight);
  }

  update(timeSeconds: number, center: THREE.Vector3): void {
    this.material.uniforms.uTime.value = timeSeconds;
    this.lastCenter.copy(center);
    if (!this.settings.enabled) return;
    this.refreshPatches(center);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      patch.mesh.visible = distance <= this.settings.distance + patch.radius;
    }
  }

  rebuild(): void {
    this.clearPatches();
    if (this.settings.enabled) this.refreshPatches(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  /** Regenerate grass for edited LOD0 pages so blades track the current surface. */
  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) {
        this.root.remove(patch.mesh);
        patch.mesh.geometry.dispose();
        this.bladeCount -= patch.bladeCount;
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;
    this.refreshPatches(this.lastCenter);
  }

  dispose(): void {
    this.clearPatches();
    this.root.clear();
    this.scene.remove(this.root);
    this.bladeGeometry.dispose();
    this.material.dispose();
  }

  getBladeCount(): number {
    return this.bladeCount;
  }

  private clearPatches(): void {
    for (const patch of this.patches) {
      this.root.remove(patch.mesh);
      patch.mesh.geometry.dispose();
    }
    this.patches = [];
    this.bladeCount = 0;
  }

  private refreshPatches(center: THREE.Vector3): void {
    const nearbyNodes = this.nodes.filter((node) => {
      const footprint = node.footprint;
      const centerX = (footprint.minX + footprint.maxX) * 0.5;
      const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
      const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
      return Math.hypot(center.x - centerX, center.z - centerZ) <= this.settings.distance + radius;
    });
    const nearbyIds = new Set(nearbyNodes.map((node) => node.id));
    const retainedPatches: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (nearbyIds.has(patch.nodeId)) {
        retainedPatches.push(patch);
      } else {
        this.root.remove(patch.mesh);
        patch.mesh.geometry.dispose();
        this.bladeCount -= patch.bladeCount;
      }
    }
    this.patches = retainedPatches;

    const retainedIds = new Set(this.patches.map((patch) => patch.nodeId));
    const newNodes = nearbyNodes.filter((node) => !retainedIds.has(node.id));
    let remainingBudget = Math.max(0, Math.floor(this.settings.maxBlades) - this.bladeCount);
    for (let index = 0; index < newNodes.length && remainingBudget > 0; index++) {
      const node = newNodes[index];
      const source = node.footprint;
      const footprint: PageFootprint = {
        minX: THREE.MathUtils.clamp(source.minX, 0, this.worldCells),
        minZ: THREE.MathUtils.clamp(source.minZ, 0, this.worldCells),
        maxX: THREE.MathUtils.clamp(source.maxX, 0, this.worldCells),
        maxZ: THREE.MathUtils.clamp(source.maxZ, 0, this.worldCells),
      };
      const remainingNodes = newNodes.length - index;
      const patchBudget = Math.ceil(remainingBudget / remainingNodes);
      const instances = generateGrassInstances(footprint, this.settings, patchBudget);
      if (instances.length === 0) continue;
      const patch = this.createPatch(node.id, footprint, instances);
      this.patches.push(patch);
      this.root.add(patch.mesh);
      this.bladeCount += patch.bladeCount;
      remainingBudget -= patch.bladeCount;
    }
  }

  private createPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", this.bladeGeometry.getAttribute("position"));
    geometry.setAttribute("uv", this.bladeGeometry.getAttribute("uv"));
    geometry.setIndex(this.bladeGeometry.getIndex());

    const offsets = new Float32Array(instances.length * 3);
    const heights = new Float32Array(instances.length);
    const rotations = new Float32Array(instances.length);
    const phases = new Float32Array(instances.length);
    const colorMixes = new Float32Array(instances.length);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      offsets.set(instance.offset, index * 3);
      heights[index] = instance.height;
      rotations[index] = instance.rotationY;
      phases[index] = instance.phase;
      colorMixes[index] = instance.colorMix;
      minY = Math.min(minY, instance.offset[1]);
      maxY = Math.max(maxY, instance.offset[1] + instance.height);
    }
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute("aHeight", new THREE.InstancedBufferAttribute(heights, 1));
    geometry.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotations, 1));
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMixes, 1));
    geometry.instanceCount = instances.length;

    const margin = this.settings.bladeWidth
      + this.settings.bladeHeight * (1 + this.settings.bladeHeightVariation) * this.settings.windStrength;
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(footprint.minX - margin, minY, footprint.minZ - margin),
      new THREE.Vector3(footprint.maxX + margin, maxY, footprint.maxZ + margin),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    return {
      nodeId,
      mesh: new THREE.Mesh(geometry, this.material),
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
    };
  }
}
