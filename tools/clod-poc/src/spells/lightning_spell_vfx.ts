import * as THREE from "three";
import type { LightningSpellVfxConfig, SpellColor } from "./spell_config.js";
import { createLightningArcNodeMaterial } from "./lightning_node_material.js";

const MIN_ARC_LENGTH = 0.35;
const BRANCH_SEGMENT_COUNT = 6;
const IMPACT_SURFACE_BIAS = 0.045;
const LIGHTNING_RENDER_ORDER = 4300;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

export interface LightningSpellSource {
  point: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface LightningSpellTarget {
  point: THREE.Vector3;
  normal?: THREE.Vector3;
}

export interface LightningSpellVfxDeps {
  scene: THREE.Scene;
  config: LightningSpellVfxConfig;
  getCamera: () => THREE.Camera;
  getSource: () => LightningSpellSource;
  getTarget: () => LightningSpellTarget | null;
  now?: () => number;
}

export interface LightningSpellVfx {
  play: (durationMs: number) => void;
  update: (nowMs: number) => void;
  dispose: () => void;
}

interface LightningState {
  active: boolean;
  startMs: number;
  durationMs: number;
  castSeed: number;
  source: THREE.Vector3;
  sourceDirection: THREE.Vector3;
  target: THREE.Vector3;
  targetNormal: THREE.Vector3;
}

interface RibbonGeometryHandle {
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  maxSegments: number;
}

interface SparkState {
  direction: THREE.Vector3;
  phase: number;
  speed: number;
  lift: number;
  scale: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash01(index: number, seed: number): number {
  return fract(Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453);
}

function spellColor(color: SpellColor): THREE.Color {
  return new THREE.Color(color[0], color[1], color[2]);
}

function createArcMaterial(color: SpellColor, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: spellColor(color),
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function createRibbonGeometry(maxSegments: number): RibbonGeometryHandle {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(Math.max(1, maxSegments) * 6 * 3), 3);
  const uv = new THREE.BufferAttribute(new Float32Array(Math.max(1, maxSegments) * 6 * 2), 2);
  const normals = new Float32Array(Math.max(1, maxSegments) * 6 * 3);
  for (let index = 2; index < normals.length; index += 3) normals[index] = 1;
  position.setUsage(THREE.DynamicDrawUsage);
  uv.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", uv);
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setDrawRange(0, 0);
  return { geometry, position, uv, maxSegments: Math.max(1, maxSegments) };
}

function writeVertex(array: Float32Array, offset: number, point: THREE.Vector3): number {
  array[offset] = point.x;
  array[offset + 1] = point.y;
  array[offset + 2] = point.z;
  return offset + 3;
}

function writeUv(array: Float32Array, offset: number, x: number, y: number): number {
  array[offset] = x;
  array[offset + 1] = y;
  return offset + 2;
}

function resolveRibbonSide(
  point: THREE.Vector3,
  tangent: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  width: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  target.copy(cameraPosition).sub(point);
  target.crossVectors(tangent, target);
  if (target.lengthSq() < 1e-8) {
    target.crossVectors(tangent, Math.abs(tangent.y) < 0.95 ? WORLD_UP : WORLD_RIGHT);
  }
  return target.normalize().multiplyScalar(width);
}

function writeRibbonGeometry(
  handle: RibbonGeometryHandle,
  polylines: readonly (readonly THREE.Vector3[])[],
  cameraPosition: THREE.Vector3,
  width: number,
  endWidthRatio: number,
): void {
  const array = handle.position.array as Float32Array;
  const uvArray = handle.uv.array as Float32Array;
  const tangent = new THREE.Vector3();
  const side0 = new THREE.Vector3();
  const side1 = new THREE.Vector3();
  const p0Left = new THREE.Vector3();
  const p0Right = new THREE.Vector3();
  const p1Left = new THREE.Vector3();
  const p1Right = new THREE.Vector3();
  let segmentCount = 0;
  let offset = 0;
  let uvOffset = 0;

  for (const points of polylines) {
    let hasPreviousEnd = false;
    for (let i = 0; i < points.length - 1 && segmentCount < handle.maxSegments; i++) {
      const span = Math.max(1, points.length - 1);
      const t0 = i / span;
      const t1 = (i + 1) / span;
      const p0 = points[i]!;
      const p1 = points[i + 1]!;
      tangent.copy(p1).sub(p0);
      if (tangent.lengthSq() < 1e-10) continue;
      tangent.normalize();
      const width0 = width * THREE.MathUtils.lerp(1, endWidthRatio, smoothstep(0.05, 1, t0));
      const width1 = width * THREE.MathUtils.lerp(1, endWidthRatio, smoothstep(0.05, 1, t1));
      if (!hasPreviousEnd) {
        resolveRibbonSide(p0, tangent, cameraPosition, width0, side0);
        p0Left.copy(p0).add(side0);
        p0Right.copy(p0).sub(side0);
      }
      resolveRibbonSide(p1, tangent, cameraPosition, width1, side1);
      p1Left.copy(p1).add(side1);
      p1Right.copy(p1).sub(side1);

      offset = writeVertex(array, offset, p0Left);
      offset = writeVertex(array, offset, p0Right);
      offset = writeVertex(array, offset, p1Left);
      offset = writeVertex(array, offset, p0Right);
      offset = writeVertex(array, offset, p1Right);
      offset = writeVertex(array, offset, p1Left);
      uvOffset = writeUv(uvArray, uvOffset, 0, t0);
      uvOffset = writeUv(uvArray, uvOffset, 1, t0);
      uvOffset = writeUv(uvArray, uvOffset, 0, t1);
      uvOffset = writeUv(uvArray, uvOffset, 1, t0);
      uvOffset = writeUv(uvArray, uvOffset, 1, t1);
      uvOffset = writeUv(uvArray, uvOffset, 0, t1);
      p0Left.copy(p1Left);
      p0Right.copy(p1Right);
      hasPreviousEnd = true;
      segmentCount++;
    }
  }

  handle.geometry.setDrawRange(0, segmentCount * 6);
  handle.position.needsUpdate = true;
  handle.uv.needsUpdate = true;
}

function createPointBuffer(segmentCount: number): THREE.Vector3[] {
  return Array.from({ length: Math.max(1, segmentCount) + 1 }, () => new THREE.Vector3());
}

function writeLightningArcPoints(
  points: THREE.Vector3[],
  start: THREE.Vector3,
  end: THREE.Vector3,
  jitter: number,
  seed: number,
): void {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(MIN_ARC_LENGTH, direction.length());
  direction.normalize();
  const side = new THREE.Vector3().crossVectors(direction, Math.abs(direction.y) < 0.9 ? WORLD_UP : WORLD_RIGHT).normalize();
  const up = new THREE.Vector3().crossVectors(side, direction).normalize();
  const span = Math.max(1, points.length - 1);
  const jitterScale = jitter * Math.min(1.8, Math.max(0.55, Math.sqrt(length / 9)));

  const valueNoise = (t: number, frequency: number, noiseSeed: number): number => {
    const x = t * frequency;
    const cell = Math.floor(x);
    const blend = smoothstep(0, 1, x - cell);
    const a = hash01(cell, noiseSeed) * 2 - 1;
    const b = hash01(cell + 1, noiseSeed) * 2 - 1;
    return THREE.MathUtils.lerp(a, b, blend);
  };

  const fractalNoise = (t: number, noiseSeed: number): number => {
    let value = 0;
    let amplitude = 1;
    let normalization = 0;
    for (let octave = 0; octave < 4; octave++) {
      value += valueNoise(t, 2 ** (octave + 1), noiseSeed + octave * 19.7) * amplitude;
      normalization += amplitude;
      amplitude *= 0.5;
    }
    return value / normalization;
  };

  for (let i = 0; i <= span; i++) {
    const t = i / span;
    const point = points[i]!;
    point.copy(start).lerp(end, t);
    if (i === 0 || i === span) continue;

    const envelope = Math.pow(Math.sin(Math.PI * t), 0.72);
    const sideNoise = (
      fractalNoise(t, seed + 1.7) * 0.9
      + (hash01(i, seed + 31.9) * 2 - 1) * 0.1
    ) * jitterScale * envelope;
    const upNoise = (
      fractalNoise(t, seed + 9.3) * 0.9
      + (hash01(i, seed + 47.1) * 2 - 1) * 0.1
    ) * jitterScale * envelope;
    point.addScaledVector(side, sideNoise).addScaledVector(up, upNoise);
  }
}

export function generateLightningArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segmentCount: number,
  jitter: number,
  seed: number,
): THREE.Vector3[] {
  const points = createPointBuffer(Math.max(1, Math.floor(segmentCount)));
  writeLightningArcPoints(points, start, end, Math.max(0, jitter), seed);
  return points;
}

export function computeLightningSpellFrame(
  startMs: number,
  durationMs: number,
  nowMs: number,
): { active: boolean; progress: number; timeSeconds: number } {
  const elapsed = nowMs - startMs;
  const progress = elapsed / Math.max(1, durationMs);
  return { active: progress < 1, progress, timeSeconds: elapsed / 1000 };
}

export function computeLightningEnvelope(progress: number): number {
  const p = clamp01(progress);
  const pulse = (start: number, attackEnd: number, fadeStart: number, end: number, intensity: number): number => (
    smoothstep(start, attackEnd, p) * (1 - smoothstep(fadeStart, end, p)) * intensity
  );
  return Math.max(
    pulse(0, 0.006, 0.055, 0.16, 1),
    pulse(0.17, 0.19, 0.27, 0.34, 0.82),
    pulse(0.37, 0.39, 0.46, 0.56, 0.48),
  );
}

function makeGroundQuaternion(normal: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
}

function makeSparkStates(count: number): SparkState[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => {
    const azimuth = hash01(index, 3.1) * Math.PI * 2;
    const elevation = 0.15 + hash01(index, 7.7) * 0.85;
    return {
      direction: new THREE.Vector3(Math.cos(azimuth), elevation, Math.sin(azimuth)).normalize(),
      phase: hash01(index, 11.2),
      speed: 0.72 + hash01(index, 19.4) * 1.45,
      lift: 0.25 + hash01(index, 23.8) * 0.9,
      scale: 0.45 + hash01(index, 31.6) * 1.1,
    };
  });
}

export function createLightningSpellVfx(deps: LightningSpellVfxDeps): LightningSpellVfx {
  const { scene, config } = deps;
  const now = deps.now ?? (() => performance.now());
  const mainPoints = createPointBuffer(config.segmentCount);
  const branchPoints = Array.from({ length: config.branchCount }, () => createPointBuffer(BRANCH_SEGMENT_COUNT));
  const mainCoreHandle = createRibbonGeometry(config.segmentCount);
  const mainGlowHandle = createRibbonGeometry(config.segmentCount);
  const branchCoreHandle = createRibbonGeometry(config.branchCount * BRANCH_SEGMENT_COUNT);
  const branchGlowHandle = createRibbonGeometry(config.branchCount * BRANCH_SEGMENT_COUNT);

  const mainCoreShading = createLightningArcNodeMaterial({ name: "lightning-main-core-node", coreColor: config.coreColor, edgeColor: config.glowColor, opacity: 1, softness: 5.5 });
  const mainGlowShading = createLightningArcNodeMaterial({ name: "lightning-main-glow-node", coreColor: config.glowColor, edgeColor: config.glowColor, opacity: 0.4, softness: 1.8 });
  const branchCoreShading = createLightningArcNodeMaterial({ name: "lightning-branch-core-node", coreColor: config.coreColor, edgeColor: config.glowColor, opacity: 0.75, softness: 4.5 });
  const branchGlowShading = createLightningArcNodeMaterial({ name: "lightning-branch-glow-node", coreColor: config.glowColor, edgeColor: config.glowColor, opacity: 0.28, softness: 1.6 });
  const mainCore = new THREE.Mesh(mainCoreHandle.geometry, mainCoreShading.material);
  const mainGlow = new THREE.Mesh(mainGlowHandle.geometry, mainGlowShading.material);
  const branchCore = new THREE.Mesh(branchCoreHandle.geometry, branchCoreShading.material);
  const branchGlow = new THREE.Mesh(branchGlowHandle.geometry, branchGlowShading.material);
  const arcMeshes = [mainGlow, branchGlow, mainCore, branchCore];
  arcMeshes.forEach((mesh, index) => {
    mesh.name = ["lightning-spell-glow", "lightning-spell-branch-glow", "lightning-spell-core", "lightning-spell-branch-core"][index]!;
    mesh.frustumCulled = false;
    mesh.renderOrder = LIGHTNING_RENDER_ORDER + index;
    mesh.visible = false;
    scene.add(mesh);
  });

  const ringMaterial = createArcMaterial(config.glowColor, 0.5);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 48), ringMaterial);
  ring.name = "lightning-spell-impact-ring";
  ring.frustumCulled = false;
  ring.renderOrder = LIGHTNING_RENDER_ORDER + 5;
  ring.visible = false;
  scene.add(ring);

  const haloMaterial = createArcMaterial(config.coreColor, 0.8);
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), haloMaterial);
  halo.name = "lightning-spell-impact-halo";
  halo.frustumCulled = false;
  halo.renderOrder = LIGHTNING_RENDER_ORDER + 6;
  halo.visible = false;
  scene.add(halo);

  const sparkStates = makeSparkStates(config.sparkCount);
  const sparkGeometry = new THREE.BoxGeometry(0.018, 0.018, 0.24);
  const sparkMaterial = createArcMaterial(config.coreColor, 0.9);
  const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, Math.max(1, sparkStates.length));
  sparks.name = "lightning-spell-sparks";
  sparks.count = sparkStates.length;
  sparks.frustumCulled = false;
  sparks.renderOrder = LIGHTNING_RENDER_ORDER + 7;
  sparks.visible = false;
  scene.add(sparks);

  const sourceLight = new THREE.PointLight(spellColor(config.glowColor), 0, config.glowDistance, config.glowDecay);
  sourceLight.name = "lightning-spell-source-light";
  sourceLight.visible = false;
  scene.add(sourceLight);
  const impactLight = new THREE.PointLight(spellColor(config.glowColor), 0, config.glowDistance, config.glowDecay);
  impactLight.name = "lightning-spell-impact-light";
  impactLight.visible = false;
  scene.add(impactLight);

  const state: LightningState = {
    active: false,
    startMs: 0,
    durationMs: 1,
    castSeed: 0,
    source: new THREE.Vector3(),
    sourceDirection: new THREE.Vector3(0, 0, -1),
    target: new THREE.Vector3(),
    targetNormal: new THREE.Vector3(0, 1, 0),
  };
  let castCounter = 0;
  const sparkMatrix = new THREE.Matrix4();
  const sparkPosition = new THREE.Vector3();
  const sparkScale = new THREE.Vector3();
  const sparkRotation = new THREE.Quaternion();
  const sparkVelocity = new THREE.Vector3();
  const branchDirection = new THREE.Vector3();
  const branchEnd = new THREE.Vector3();
  const branchSide = new THREE.Vector3();
  const branchUp = new THREE.Vector3();
  const sourceToTarget = new THREE.Vector3();

  const setVisible = (visible: boolean): void => {
    for (const mesh of arcMeshes) mesh.visible = visible;
    ring.visible = visible;
    halo.visible = visible;
    sparks.visible = visible && sparkStates.length > 0;
    sourceLight.visible = visible;
    impactLight.visible = visible;
    if (!visible) {
      sourceLight.intensity = 0;
      impactLight.intensity = 0;
    }
  };

  const resolveSource = (): void => {
    const source = deps.getSource();
    state.source.copy(source.point);
    state.sourceDirection.copy(source.direction);
    if (state.sourceDirection.lengthSq() < 1e-8) state.sourceDirection.set(0, 0, -1);
    else state.sourceDirection.normalize();
  };

  // Resolve the impact target once at cast time so the active frame doesn't raycast terrain every tick.
  const resolveTargetOnce = (): void => {
    const target = deps.getTarget();
    if (target) {
      state.target.copy(target.point);
      state.targetNormal.copy(target.normal ?? WORLD_UP).normalize();
    } else {
      state.target.copy(state.source).addScaledVector(state.sourceDirection, config.maxRange);
      state.targetNormal.copy(WORLD_UP);
    }
  };

  const clampTargetToSource = (): void => {
    sourceToTarget.copy(state.target).sub(state.source);
    const distance = sourceToTarget.length();
    if (distance > config.maxRange) {
      state.target.copy(state.source).addScaledVector(sourceToTarget.normalize(), config.maxRange);
    } else if (distance < MIN_ARC_LENGTH) {
      state.target.copy(state.source).addScaledVector(state.sourceDirection, MIN_ARC_LENGTH);
    }
  };

  const updateBranches = (seed: number): void => {
    const mainSpan = Math.max(1, mainPoints.length - 1);
    const minLength = Math.min(config.branchLengthMin, config.branchLengthMax);
    const maxLength = Math.max(config.branchLengthMin, config.branchLengthMax);
    for (let index = 0; index < branchPoints.length; index++) {
      const t = 0.12 + hash01(index, seed + 41) * 0.74;
      const startIndex = Math.min(mainSpan - 1, Math.max(1, Math.floor(t * mainSpan)));
      const start = mainPoints[startIndex]!;
      const next = mainPoints[Math.min(mainSpan, startIndex + 1)]!;
      branchDirection.copy(next).sub(start).normalize();
      branchSide.crossVectors(branchDirection, Math.abs(branchDirection.y) < 0.92 ? WORLD_UP : WORLD_RIGHT).normalize();
      branchUp.crossVectors(branchSide, branchDirection).normalize();
      branchDirection.multiplyScalar(0.45)
        .addScaledVector(branchSide, hash01(index, seed + 53) * 2 - 1)
        .addScaledVector(branchUp, hash01(index, seed + 67) * 1.6 - 0.35)
        .normalize();
      const length = THREE.MathUtils.lerp(minLength, maxLength, hash01(index, seed + 79));
      branchEnd.copy(start).addScaledVector(branchDirection, length);
      writeLightningArcPoints(branchPoints[index]!, start, branchEnd, config.jitter * 0.42, seed + index * 13.7);
    }
  };

  const updateSparks = (timeSeconds: number, envelope: number): void => {
    sparkMaterial.opacity = envelope * 0.88;
    sparks.visible = envelope > 0.01 && sparkStates.length > 0;
    for (let index = 0; index < sparkStates.length; index++) {
      const spark = sparkStates[index]!;
      const age = fract(timeSeconds * spark.speed + spark.phase);
      const radialDistance = config.impactRadius * (0.14 + age * 1.75);
      const lift = Math.sin(age * Math.PI) * config.impactRadius * spark.lift;
      sparkPosition.copy(state.target)
        .addScaledVector(spark.direction, radialDistance)
        .addScaledVector(state.targetNormal, IMPACT_SURFACE_BIAS + lift);
      const size = spark.scale * (1 - age) * envelope;
      sparkScale.setScalar(Math.max(0.001, size));
      sparkVelocity.copy(spark.direction).addScaledVector(state.targetNormal, spark.lift * (1 - age)).normalize();
      sparkRotation.setFromUnitVectors(WORLD_FORWARD, sparkVelocity);
      sparkMatrix.compose(sparkPosition, sparkRotation, sparkScale);
      sparks.setMatrixAt(index, sparkMatrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
  };

  const updateActiveFrame = (frameNow: number): void => {
    const frame = computeLightningSpellFrame(state.startMs, state.durationMs, frameNow);
    if (!frame.active) {
      state.active = false;
      setVisible(false);
      return;
    }

    resolveSource();
    clampTargetToSource();
    const refreshFrame = Math.floor(frame.timeSeconds * config.refreshHz);
    const seed = state.castSeed + refreshFrame * 17.17;
    writeLightningArcPoints(mainPoints, state.source, state.target, config.jitter, seed);
    updateBranches(seed);

    const cameraPosition = deps.getCamera().position;
    writeRibbonGeometry(mainCoreHandle, [mainPoints], cameraPosition, config.coreWidth, 0.72);
    writeRibbonGeometry(mainGlowHandle, [mainPoints], cameraPosition, config.glowWidth, 0.62);
    writeRibbonGeometry(branchCoreHandle, branchPoints, cameraPosition, config.coreWidth * 0.58, 0.04);
    writeRibbonGeometry(branchGlowHandle, branchPoints, cameraPosition, config.glowWidth * 0.64, 0.03);

    const envelope = computeLightningEnvelope(frame.progress);
    const flicker = 0.72 + hash01(refreshFrame, state.castSeed + 101) * 0.28;
    for (const handle of [mainCoreShading, mainGlowShading, branchCoreShading, branchGlowShading]) {
      handle.uTime.value = frame.timeSeconds;
    }
    mainCoreShading.uOpacity.value = clamp01(envelope * (0.78 + flicker * 0.24));
    mainGlowShading.uOpacity.value = envelope * (0.14 + flicker * 0.16);
    branchCoreShading.uOpacity.value = envelope * (0.34 + flicker * 0.22);
    branchGlowShading.uOpacity.value = envelope * (0.08 + flicker * 0.12);

    const ringPulse = 0.72 + Math.sin(frame.timeSeconds * 36) * 0.18 + flicker * 0.18;
    ring.position.copy(state.target).addScaledVector(state.targetNormal, IMPACT_SURFACE_BIAS);
    ring.quaternion.copy(makeGroundQuaternion(state.targetNormal));
    ring.scale.setScalar(config.impactRadius * ringPulse);
    ring.rotation.z = frame.timeSeconds * 2.4;
    ringMaterial.opacity = envelope * (0.12 + flicker * 0.24);

    halo.position.copy(state.target).addScaledVector(state.targetNormal, IMPACT_SURFACE_BIAS * 1.5);
    halo.scale.setScalar(config.impactRadius * (0.08 + flicker * 0.1));
    halo.rotation.set(frame.timeSeconds * 4.2, frame.timeSeconds * 5.3, frame.timeSeconds * 3.7);
    haloMaterial.opacity = envelope * (0.12 + flicker * 0.12);

    sourceLight.position.copy(state.source);
    impactLight.position.copy(state.target).addScaledVector(state.targetNormal, 0.15);
    sourceLight.intensity = config.sourceLightIntensity * envelope * flicker;
    impactLight.intensity = config.impactLightIntensity * envelope * (0.72 + flicker * 0.45);
    updateSparks(frame.timeSeconds, envelope);
    setVisible(envelope > 0.005);
  };

  return {
    play: (durationMs) => {
      state.startMs = now();
      state.durationMs = Math.max(1, durationMs);
      state.castSeed = ++castCounter * 113.17;
      state.active = true;
      resolveSource();
      resolveTargetOnce();
      clampTargetToSource();
      setVisible(true);
      updateActiveFrame(state.startMs + 1);
    },
    update: (nowMs) => {
      if (!state.active) return;
      updateActiveFrame(nowMs);
    },
    dispose: () => {
      for (const mesh of arcMeshes) scene.remove(mesh);
      scene.remove(ring);
      scene.remove(halo);
      scene.remove(sparks);
      scene.remove(sourceLight);
      scene.remove(impactLight);
      mainCoreHandle.geometry.dispose();
      mainGlowHandle.geometry.dispose();
      branchCoreHandle.geometry.dispose();
      branchGlowHandle.geometry.dispose();
      mainCoreShading.material.dispose();
      mainGlowShading.material.dispose();
      branchCoreShading.material.dispose();
      branchGlowShading.material.dispose();
      ring.geometry.dispose();
      ringMaterial.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
    },
  };
}
