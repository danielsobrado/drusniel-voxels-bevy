import * as THREE from "three";
import { mulberry32 } from "../ui/icons/drawing.js";

export interface AgentRenderEnvelopeConfig {
  readonly count: number;
  readonly seed: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly spreadM: number;
  readonly skinned: boolean;
}

export interface AgentRenderEnvelope {
  readonly root: THREE.Group;
  update(deltaSeconds: number, counters: Record<string, number>): void;
  dispose(): void;
}

function scatterOffsets(count: number, seed: number, centerX: number, centerZ: number, spreadM: number): Float32Array {
  const rng = mulberry32(seed);
  const offsets = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * spreadM;
    offsets[index * 3] = centerX + Math.cos(angle) * radius;
    offsets[index * 3 + 1] = 0;
    offsets[index * 3 + 2] = centerZ + Math.sin(angle) * radius;
  }
  return offsets;
}

function skinnedBoxGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(0.4, 1, 0.3);
  const vertexCount = geometry.attributes.position!.count;
  const skinIndex = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    skinIndex[vertex * 4] = 1;
    skinWeight[vertex * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  return geometry;
}

function createSharedWalkClip(skeleton: THREE.Skeleton): THREE.AnimationClip {
  const times = [0, 0.5, 1];
  const values = [0, 0.15, 0];
  const track = new THREE.NumberKeyframeTrack(`${skeleton.bones[1]!.uuid}.position[y]`, times, values);
  return new THREE.AnimationClip("agent-walk", 1, [track]);
}

function createSkinnedAgent(
  offsets: Float32Array,
  index: number,
  sharedGeometry: THREE.BufferGeometry,
  sharedMaterial: THREE.Material,
  sharedClip: THREE.AnimationClip,
): { mesh: THREE.SkinnedMesh; mixer: THREE.AnimationMixer } {
  const rootBone = new THREE.Bone();
  rootBone.position.set(0, 0.5, 0);
  const upperBone = new THREE.Bone();
  upperBone.position.set(0, 0.5, 0);
  rootBone.add(upperBone);
  const skeleton = new THREE.Skeleton([rootBone, upperBone]);
  const mesh = new THREE.SkinnedMesh(sharedGeometry, sharedMaterial);
  mesh.add(rootBone);
  mesh.bind(skeleton);
  mesh.position.set(offsets[index * 3]!, offsets[index * 3 + 1]!, offsets[index * 3 + 2]!);
  const mixer = new THREE.AnimationMixer(mesh);
  mixer.clipAction(sharedClip).play();
  return { mesh, mixer };
}

export function createAgentRenderEnvelope(
  scene: THREE.Scene,
  config: AgentRenderEnvelopeConfig,
): AgentRenderEnvelope {
  const root = new THREE.Group();
  root.name = "agent-envelope-root";
  scene.add(root);

  const offsets = scatterOffsets(config.count, config.seed, config.centerX, config.centerZ, config.spreadM);
  const mixers: THREE.AnimationMixer[] = [];
  let drawEstimate = 0;

  if (config.skinned) {
    const geometry = skinnedBoxGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0x8a6a4a });
    const templateBone = new THREE.Bone();
    templateBone.position.set(0, 0.5, 0);
    const templateUpper = new THREE.Bone();
    templateUpper.position.set(0, 0.5, 0);
    templateBone.add(templateUpper);
    const templateSkeleton = new THREE.Skeleton([templateBone, templateUpper]);
    const clip = createSharedWalkClip(templateSkeleton);
    for (let index = 0; index < config.count; index += 1) {
      const agent = createSkinnedAgent(offsets, index, geometry, material, clip);
      root.add(agent.mesh);
      mixers.push(agent.mixer);
    }
    drawEstimate = config.count;
  } else {
    const geometry = new THREE.ConeGeometry(0.35, 1.2, 5);
    const material = new THREE.MeshStandardMaterial({ color: 0x5f7f9f, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(config.count, 1));
    mesh.count = config.count;
    mesh.name = "agent-envelope-static";
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let index = 0; index < config.count; index += 1) {
      position.set(offsets[index * 3]!, offsets[index * 3 + 1]! + 0.6, offsets[index * 3 + 2]!);
      matrix.makeTranslation(position.x, position.y, position.z);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    drawEstimate = config.count > 0 ? 1 : 0;
  }

  return {
    root,
    update(deltaSeconds, counters) {
      const started = performance.now();
      for (const mixer of mixers) mixer.update(deltaSeconds);
      counters["agents_total"] = config.count;
      counters["agent_draws"] = drawEstimate;
      counters["agent_anim_ms"] = performance.now() - started;
    },
    dispose() {
      scene.remove(root);
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material?.dispose();
        }
      });
    },
  };
}
