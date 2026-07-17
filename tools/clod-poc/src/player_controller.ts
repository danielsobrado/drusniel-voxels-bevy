import * as THREE from "three";
import type { CapsuleCollisionConfig, TerrainColliderSet } from "./terrain/terrain_collider.js";
import type { PropColliderSet } from "./props/prop_collider.js";
import type { ConstructionColliderSet } from "./construction/construction_collider.js";
import type { WaterAuthority } from "./water/water_authority.js";
import { emitAudio } from "./audio/index.js";
import { gameplayDiagnostics } from "./player/gameplay_diagnostics.js";
import { defaultSwimConfig, type SwimConfig } from "./player/swim_config.js";
import {
  DRY_SWIM_CONTACT,
  applySwimForces,
  resolveSwimContact,
  type SwimContactState,
  type SwimMode,
} from "./player/swim_locomotion.js";

/**
 * Movement readiness for a world column (playable-world-contract P2/P5):
 * - "ready": exact/stale-safe collision and canonical water query are ready.
 * - "certified": no collider, but the column is certified single-surface.
 * - "blocked": collision or water authority is unknown — the readiness frontier.
 */
export type MovementReadiness = "ready" | "certified" | "blocked";
export type MovementReadinessProbe = (x: number, z: number) => MovementReadiness;

export type PlayerInteractionMode = "orbit" | "choosingSpawn" | "playing";

export interface PlayerInputState {
  forward: number;
  right: number;
  sprint: boolean;
  jump: boolean;
  dive?: boolean;
}

export interface NormalizedPlayerInput {
  direction: THREE.Vector2;
  speed: number;
  jump: boolean;
  dive: boolean;
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
  worldEdgePushbackBand: number;
  worldEdgePushbackAcceleration: number;
  gravity: number;
  fixedStep: number;
  recoveryDepth: number;
  maxFallSpeed: number;
  killPlaneY: number;
  invalidColumnRecoverySteps: number;
  groundAcceleration: number;
  airAcceleration: number;
  coyoteTime: number;
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
  worldEdgePushbackBand: 48,
  worldEdgePushbackAcceleration: 36,
  gravity: 30,
  fixedStep: 1 / 120,
  recoveryDepth: 32,
  maxFallSpeed: 80,
  killPlaneY: -256,
  invalidColumnRecoverySteps: 60,
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
    dive: input.dive === true,
  };
}

export function jumpVelocityForHeight(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * height);
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

export function validatePlayerWorldBoundsFit(
  bounds: HorizontalWorldBounds,
  config: Readonly<PlayerConfig>,
): void {
  if (!allFinite([bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ])) {
    throw new Error("Player world bounds must be finite numbers");
  }
  if (!Number.isFinite(config.worldEdgeMargin) || config.worldEdgeMargin <= 0) {
    throw new Error("Player world edge margin must be a finite number greater than 0");
  }
  if (!Number.isFinite(config.worldEdgePushbackBand) || config.worldEdgePushbackBand < 0) {
    throw new Error("Player world edge pushback band must be a finite number greater than or equal to 0");
  }
  if (!Number.isFinite(config.worldEdgePushbackAcceleration) || config.worldEdgePushbackAcceleration < 0) {
    throw new Error("Player world edge pushback acceleration must be a finite number greater than or equal to 0");
  }
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
    throw new Error("Player world bounds must have positive width and depth");
  }
  const safeWidth = bounds.maxX - bounds.minX - config.worldEdgeMargin * 2;
  const safeDepth = bounds.maxZ - bounds.minZ - config.worldEdgeMargin * 2;
  if (safeWidth <= 0 || safeDepth <= 0) {
    throw new Error(
      `Player world bounds too small for margin ${config.worldEdgeMargin}: safeWidth=${safeWidth}, safeDepth=${safeDepth}`,
    );
  }
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

function edgeStrength(distanceToSafeEdge: number, band: number): number {
  if (band <= 0) return 0;
  const t = THREE.MathUtils.clamp(1 - distanceToSafeEdge / band, 0, 1);
  return t * t;
}

export function writeWorldEdgePushbackAcceleration(
  out: THREE.Vector2,
  position: THREE.Vector3,
  bounds: HorizontalWorldBounds,
  margin: number,
  band: number,
  acceleration: number,
): THREE.Vector2 {
  out.set(0, 0);
  if (acceleration <= 0 || band <= 0) return out;

  const minX = bounds.minX + margin;
  const maxX = bounds.maxX - margin;
  const minZ = bounds.minZ + margin;
  const maxZ = bounds.maxZ - margin;

  out.x += edgeStrength(position.x - minX, band) * acceleration;
  out.x -= edgeStrength(maxX - position.x, band) * acceleration;
  out.y += edgeStrength(position.z - minZ, band) * acceleration;
  out.y -= edgeStrength(maxZ - position.z, band) * acceleration;
  return out;
}

export function worldEdgePushbackAcceleration(
  position: THREE.Vector3,
  bounds: HorizontalWorldBounds,
  margin: number,
  band: number,
  acceleration: number,
): THREE.Vector2 {
  return writeWorldEdgePushbackAcceleration(new THREE.Vector2(), position, bounds, margin, band, acceleration);
}

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly lastSafePosition = new THREE.Vector3();
  spawned = false;
  grounded = false;
  lastPhysicsMs = 0;
  lastPagesTested = 0;
  private accumulator = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private invalidColumnSteps = 0;
  private readonly edgePushback = new THREE.Vector2();
  private readonly physicsSamples: number[] = [];
  private propColliders: PropColliderSet | null = null;
  private constructionColliders: ConstructionColliderSet | null = null;
  private movementReadiness: MovementReadinessProbe | null = null;
  private waterAuthority: WaterAuthority | null = null;
  private swimContact: SwimContactState = { ...DRY_SWIM_CONTACT };

  constructor(
    private readonly colliders: TerrainColliderSet,
    private readonly bounds: HorizontalWorldBounds,
    readonly config: Readonly<PlayerConfig> = DEFAULT_PLAYER_CONFIG,
    readonly swimConfig: Readonly<SwimConfig> = defaultSwimConfig,
  ) {
    validatePlayerWorldBoundsFit(bounds, config);
  }

  get swimMode(): SwimMode {
    return this.swimContact.mode;
  }

  get waterSubmersionM(): number {
    return this.swimContact.submersionM;
  }

  get waterBodyId(): string {
    return this.swimContact.bodyId;
  }

  attachPropColliders(set: PropColliderSet | null): void {
    this.propColliders = set;
  }

  attachConstructionColliders(set: ConstructionColliderSet | null): void {
    this.constructionColliders = set;
  }

  attachMovementReadiness(probe: MovementReadinessProbe | null): void {
    this.movementReadiness = probe;
  }

  attachWaterAuthority(authority: WaterAuthority | null): void {
    this.waterAuthority = authority;
    if (!authority) this.swimContact = { ...DRY_SWIM_CONTACT };
  }

  spawn(point: THREE.Vector3): void {
    this.spawned = true;
    this.position.copy(point).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.02);
    clampPlayerToWorld(this.position, this.bounds, this.config.worldEdgeMargin);
    this.velocity.set(0, 0, 0);
    this.lastSafePosition.copy(this.position);
    this.grounded = false;
    this.accumulator = 0;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.invalidColumnSteps = 0;
    this.swimContact = { ...DRY_SWIM_CONTACT };
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
      this.fixedUpdate(this.config.fixedStep, desiredMotion, normalized.jump, normalized.dive);
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

  private fixedUpdate(step: number, desiredMotion: THREE.Vector3, jumpHeld: boolean, diveHeld: boolean): void {
    const waterSample = this.waterAuthority?.sample(this.position.x, this.position.z) ?? null;
    if (waterSample) {
      this.swimContact = resolveSwimContact(
        this.swimContact,
        waterSample,
        this.position.y,
        this.config.capsuleHeight,
        this.swimConfig,
      );
    } else {
      this.swimContact = { ...DRY_SWIM_CONTACT };
    }
    const swimming = this.swimContact.mode === "surface" || this.swimContact.mode === "submerged";
    const blockedByUnknownWater = this.swimContact.mode === "blocked_unknown";

    if (blockedByUnknownWater) {
      this.velocity.set(0, 0, 0);
      gameplayDiagnostics.add("water_query_blocked_steps");
    } else if (swimming && waterSample) {
      const result = applySwimForces({
        velocity: this.velocity,
        desiredX: desiredMotion.x,
        desiredZ: desiredMotion.z,
        ascend: jumpHeld,
        dive: diveHeld,
        capsuleBottomY: this.position.y,
        sample: waterSample,
        contact: this.swimContact,
        stepSeconds: step,
        config: this.swimConfig,
      });
      this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    } else {
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
      if (this.velocity.y < -this.config.maxFallSpeed) this.velocity.y = -this.config.maxFallSpeed;
    }

    if (blockedByUnknownWater) {
      this.edgePushback.set(0, 0);
    } else {
      writeWorldEdgePushbackAcceleration(
        this.edgePushback,
        this.position,
        this.bounds,
        this.config.worldEdgeMargin,
        this.config.worldEdgePushbackBand,
        this.config.worldEdgePushbackAcceleration,
      );
      this.velocity.x += this.edgePushback.x * step;
      this.velocity.z += this.edgePushback.y * step;
    }

    if (this.movementReadiness && (this.velocity.x !== 0 || this.velocity.z !== 0)
      && this.movementReadiness(this.position.x, this.position.z) !== "blocked") {
      const radius = this.config.capsuleRadius;
      const aheadX = this.position.x + this.velocity.x * step + Math.sign(this.velocity.x) * radius;
      const aheadZ = this.position.z + this.velocity.z * step + Math.sign(this.velocity.z) * radius;
      let engaged = false;
      if (this.velocity.x !== 0 && this.movementReadiness(aheadX, this.position.z) === "blocked") {
        this.velocity.x = 0;
        engaged = true;
      }
      if (this.velocity.z !== 0 && this.movementReadiness(this.position.x, aheadZ) === "blocked") {
        this.velocity.z = 0;
        engaged = true;
      }
      if (!engaged && this.velocity.x !== 0 && this.velocity.z !== 0
        && this.movementReadiness(aheadX, aheadZ) === "blocked") {
        this.velocity.x = 0;
        this.velocity.z = 0;
        engaged = true;
      }
      if (engaged) gameplayDiagnostics.add("frontier_barrier_engagements");
    }

    const previousX = this.position.x;
    const previousZ = this.position.z;
    const previousBlocked = this.movementReadiness
      ? this.movementReadiness(previousX, previousZ) === "blocked"
      : false;
    this.position.addScaledVector(this.velocity, step);
    clampPlayerToWorld(this.position, this.bounds, this.config.worldEdgeMargin);
    if (this.position.x !== previousX + this.velocity.x * step) this.velocity.x = 0;
    if (this.position.z !== previousZ + this.velocity.z * step) this.velocity.z = 0;

    const collision = this.colliders.resolveCapsule(this.position, this.velocity, this.config);
    let resolved = collision;
    if (this.propColliders && this.propColliders.activeCount() > 0) {
      const propHit = this.propColliders.resolveCapsule(resolved.position, resolved.velocity, this.config);
      resolved = {
        position: propHit.position,
        velocity: propHit.velocity,
        grounded: resolved.grounded || propHit.grounded,
        pagesTested: resolved.pagesTested + propHit.pagesTested,
      };
    }
    if (this.constructionColliders && this.constructionColliders.activeCount() > 0) {
      const pieceHit = this.constructionColliders.resolveCapsule(resolved.position, resolved.velocity, this.config);
      resolved = {
        position: pieceHit.position,
        velocity: pieceHit.velocity,
        grounded: resolved.grounded || pieceHit.grounded,
        pagesTested: resolved.pagesTested + pieceHit.pagesTested,
      };
    }
    this.position.copy(resolved.position);
    this.velocity.copy(resolved.velocity);
    this.grounded = swimming ? false : resolved.grounded;
    this.lastPagesTested = resolved.pagesTested;

    if (this.movementReadiness && !previousBlocked
      && this.movementReadiness(this.position.x, this.position.z) === "blocked") {
      this.position.x = previousX;
      this.position.z = previousZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
      gameplayDiagnostics.add("frontier_barrier_engagements");
    }

    if (this.grounded) this.lastSafePosition.copy(this.position);
    this.applyRecoveryContract();
  }

  private applyRecoveryContract(): void {
    if (!Number.isFinite(this.position.x + this.position.y + this.position.z)
      || !Number.isFinite(this.velocity.x + this.velocity.y + this.velocity.z)) {
      this.recoverToLastSafe("player_recovery_non_finite");
      return;
    }
    if (this.position.y < this.config.killPlaneY) {
      this.recoverToLastSafe("player_recovery_kill_plane");
      return;
    }
    if (!this.movementReadiness) {
      if (this.position.y < this.lastSafePosition.y - this.config.recoveryDepth) {
        this.recoverToLastSafe("player_recovery_backstop_depth");
      }
      return;
    }
    const blockedColumn = this.movementReadiness(this.position.x, this.position.z) === "blocked";
    if (blockedColumn && !this.grounded && this.swimContact.mode !== "blocked_unknown") {
      this.invalidColumnSteps++;
      if (this.invalidColumnSteps >= this.config.invalidColumnRecoverySteps) {
        this.recoverToLastSafe("player_recovery_missing_collider");
        return;
      }
      if (this.position.y < this.lastSafePosition.y - this.config.recoveryDepth) {
        this.recoverToLastSafe("player_recovery_backstop_depth");
      }
    } else {
      this.invalidColumnSteps = 0;
    }
  }

  private recoverToLastSafe(reason: "player_recovery_non_finite" | "player_recovery_kill_plane" | "player_recovery_missing_collider" | "player_recovery_backstop_depth"): void {
    this.position.copy(this.lastSafePosition);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.invalidColumnSteps = 0;
    this.swimContact = { ...DRY_SWIM_CONTACT };
    gameplayDiagnostics.add(reason);
  }
}
