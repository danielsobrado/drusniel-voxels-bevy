import * as THREE from "three";
import type { CapsuleCollisionConfig, TerrainColliderSet } from "./terrain_collider.js";

export type PlayerInteractionMode = "orbit" | "choosingSpawn" | "playing";

export interface PlayerInputState {
  forward: number;
  right: number;
  sprint: boolean;
  jump: boolean;
}

export interface NormalizedPlayerInput {
  direction: THREE.Vector2;
  speed: number;
  jump: boolean;
}

export interface HorizontalWorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface PlayerConfig extends CapsuleCollisionConfig {
  walkSpeed: number;
  runSpeed: number;
  jumpHeight: number;
  eyeHeight: number;
  worldEdgeMargin: number;
  gravity: number;
  fixedStep: number;
  recoveryDepth: number;
}

export const DEFAULT_PLAYER_CONFIG: Readonly<PlayerConfig> = Object.freeze({
  walkSpeed: 8,
  runSpeed: 16,
  jumpHeight: 4,
  capsuleRadius: 0.45,
  capsuleHeight: 1.8,
  eyeHeight: 1.7,
  maxSlopeDegrees: 60,
  worldEdgeMargin: 16,
  gravity: 30,
  fixedStep: 1 / 120,
  recoveryDepth: 32,
});

export class PlayerInteractionState {
  mode: PlayerInteractionMode = "orbit";

  chooseSpawn(): void {
    this.mode = "choosingSpawn";
  }

  startPlaying(): void {
    this.mode = "playing";
  }

  exitToOrbit(): void {
    this.mode = "orbit";
  }
}

export function normalizeMovementInput(
  input: PlayerInputState,
  config: Readonly<PlayerConfig> = DEFAULT_PLAYER_CONFIG,
): NormalizedPlayerInput {
  const direction = new THREE.Vector2(input.right, input.forward);
  if (direction.lengthSq() > 1) direction.normalize();
  return {
    direction,
    speed: input.sprint ? config.runSpeed : config.walkSpeed,
    jump: input.jump,
  };
}

export function jumpVelocityForHeight(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * height);
}

export function clampPlayerToWorld(
  position: THREE.Vector3,
  bounds: HorizontalWorldBounds,
  margin: number,
): THREE.Vector3 {
  position.x = THREE.MathUtils.clamp(position.x, bounds.minX + margin, bounds.maxX - margin);
  position.z = THREE.MathUtils.clamp(position.z, bounds.minZ + margin, bounds.maxZ - margin);
  return position;
}

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly lastSafePosition = new THREE.Vector3();
  grounded = false;
  lastPhysicsMs = 0;
  lastPagesTested = 0;
  private accumulator = 0;
  private readonly physicsSamples: number[] = [];

  constructor(
    private readonly colliders: TerrainColliderSet,
    private readonly bounds: HorizontalWorldBounds,
    readonly config: Readonly<PlayerConfig> = DEFAULT_PLAYER_CONFIG,
  ) {}

  spawn(point: THREE.Vector3): void {
    this.position.copy(point).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.02);
    clampPlayerToWorld(this.position, this.bounds, this.config.worldEdgeMargin);
    this.velocity.set(0, 0, 0);
    this.lastSafePosition.copy(this.position);
    this.grounded = false;
    this.accumulator = 0;
  }

  update(deltaSeconds: number, input: PlayerInputState, cameraForward: THREE.Vector3): void {
    const startedAt = performance.now();
    const normalized = normalizeMovementInput(input, this.config);
    const forward = cameraForward.clone();
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    else forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const desiredMotion = forward.multiplyScalar(normalized.direction.y)
      .addScaledVector(right, normalized.direction.x)
      .multiplyScalar(normalized.speed);

    this.accumulator += Math.min(Math.max(deltaSeconds, 0), 0.1);
    let jumpPending = normalized.jump;
    let steps = 0;
    while (this.accumulator >= this.config.fixedStep && steps < 12) {
      this.fixedUpdate(this.config.fixedStep, desiredMotion, jumpPending);
      jumpPending = false;
      this.accumulator -= this.config.fixedStep;
      steps++;
    }

    this.lastPhysicsMs = performance.now() - startedAt;
    this.physicsSamples.push(this.lastPhysicsMs);
    if (this.physicsSamples.length > 240) this.physicsSamples.shift();
  }

  physicsP95Ms(): number {
    if (this.physicsSamples.length === 0) return 0;
    const sorted = [...this.physicsSamples].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * 0.95)];
  }

  private fixedUpdate(step: number, desiredMotion: THREE.Vector3, jump: boolean): void {
    this.velocity.x = desiredMotion.x;
    this.velocity.z = desiredMotion.z;
    if (jump && this.grounded) {
      this.velocity.y = jumpVelocityForHeight(this.config.jumpHeight, this.config.gravity);
      this.grounded = false;
    } else {
      this.velocity.y -= this.config.gravity * step;
    }

    const previousX = this.position.x;
    const previousZ = this.position.z;
    this.position.addScaledVector(this.velocity, step);
    clampPlayerToWorld(this.position, this.bounds, this.config.worldEdgeMargin);
    if (this.position.x !== previousX + this.velocity.x * step) this.velocity.x = 0;
    if (this.position.z !== previousZ + this.velocity.z * step) this.velocity.z = 0;

    const collision = this.colliders.resolveCapsule(this.position, this.velocity, this.config);
    this.position.copy(collision.position);
    this.velocity.copy(collision.velocity);
    this.grounded = collision.grounded;
    this.lastPagesTested = collision.pagesTested;
    if (this.grounded) this.lastSafePosition.copy(this.position);

    if (this.position.y < this.lastSafePosition.y - this.config.recoveryDepth) {
      this.position.copy(this.lastSafePosition);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
    }
  }
}
