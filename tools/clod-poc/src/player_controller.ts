import * as THREE from "three";
import type { CapsuleCollisionConfig, TerrainColliderSet } from "./terrain_collider.js";
import { emitAudio } from "./audio/index.js";

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
  /** Horizontal accel toward the desired velocity while grounded (units/s²). */
  groundAcceleration: number;
  /** Reduced horizontal accel while airborne — steerable but not instant. */
  airAcceleration: number;
  /** Grace window after leaving the ground in which a jump still fires (s). */
  coyoteTime: number;
  /** A jump pressed this long before landing still fires on touchdown (s). */
  jumpBufferTime: number;
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
  groundAcceleration: 60,
  airAcceleration: 16,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
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
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
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
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
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
    let steps = 0;
    while (this.accumulator >= this.config.fixedStep && steps < 12) {
      this.fixedUpdate(this.config.fixedStep, desiredMotion, normalized.jump);
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

  private fixedUpdate(step: number, desiredMotion: THREE.Vector3, jumpHeld: boolean): void {
    // Accelerate toward the desired velocity: full traction grounded, reduced in the air.
    const accel = (this.grounded ? this.config.groundAcceleration : this.config.airAcceleration) * step;
    this.velocity.x += THREE.MathUtils.clamp(desiredMotion.x - this.velocity.x, -accel, accel);
    this.velocity.z += THREE.MathUtils.clamp(desiredMotion.z - this.velocity.z, -accel, accel);

    this.coyoteTimer = this.grounded ? this.config.coyoteTime : Math.max(0, this.coyoteTimer - step);
    this.jumpBufferTimer = jumpHeld ? this.config.jumpBufferTime : Math.max(0, this.jumpBufferTimer - step);
    if (this.jumpBufferTimer > 0 && (this.grounded || this.coyoteTimer > 0)) {
      this.velocity.y = jumpVelocityForHeight(this.config.jumpHeight, this.config.gravity);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      emitAudio("player.jump");
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
