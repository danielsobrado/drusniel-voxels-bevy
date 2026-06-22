import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import type { CamPose } from "./hooks.js";

const FORWARD = new Vector3();
const RIGHT = new Vector3();
const MOVE = new Vector3();

export class FlyCamera {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  speed = 22;
  enabled = true;

  private readonly keys = new Set<string>();
  private readonly velocity = new Vector3();
  private locked = false;
  private baseFov: number;

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.baseFov = camera.fov;

    dom.addEventListener("click", () => {
      if (!this.enabled || this.locked) return;
      const promise = dom.requestPointerLock() as unknown as Promise<void> | undefined;
      promise?.catch(() => undefined);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === dom;
    });
    document.addEventListener("mousemove", (event) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= event.movementX * 0.0022;
      this.pitch -= event.movementY * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    });
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyP") console.log(`[clod-poc] cam=${this.toCamString()}`);
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    dom.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.speed *= Math.pow(1.15, -Math.sign(event.deltaY));
      this.speed = Math.min(400, Math.max(0.5, this.speed));
    }, { passive: false });
  }

  setPose(pose: CamPose): void {
    this.camera.position.set(pose.p[0], pose.p[1], pose.p[2]);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    if (pose.fov !== undefined) {
      this.baseFov = pose.fov;
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.applyRotation();
    this.camera.updateMatrixWorld();
  }

  getPose(): CamPose {
    return {
      p: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      yaw: this.yaw,
      pitch: this.pitch,
      fov: this.baseFov,
    };
  }

  toCamString(): string {
    const p = this.camera.position;
    return `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${this.yaw.toFixed(4)},${this.pitch.toFixed(4)},${this.baseFov.toFixed(0)}`;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.applyRotation();
    FORWARD.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    RIGHT.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    MOVE.set(0, 0, 0);
    if (this.keys.has("KeyW")) MOVE.add(FORWARD);
    if (this.keys.has("KeyS")) MOVE.sub(FORWARD);
    if (this.keys.has("KeyD")) MOVE.add(RIGHT);
    if (this.keys.has("KeyA")) MOVE.sub(RIGHT);
    if (this.keys.has("KeyE") || this.keys.has("Space")) MOVE.y += 1;
    if (this.keys.has("KeyQ") || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) MOVE.y -= 1;

    let target = 0;
    if (MOVE.lengthSq() > 0) {
      MOVE.normalize();
      target = this.speed;
    }
    this.velocity.lerp(MOVE.multiplyScalar(target), 1 - Math.exp(-dt * 9));
    this.camera.position.addScaledVector(this.velocity, dt);
    this.camera.updateMatrixWorld();
  }

  private applyRotation(): void {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
