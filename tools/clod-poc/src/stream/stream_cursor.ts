export type StreamCursorSource =
  | "playing_player"
  | "orbit_spawned_player"
  | "orbit_camera"
  | "orbit_target";

export interface StreamCursor {
  frameId: number;
  center: { x: number; z: number };
  velocityMps: { x: number; z: number };
  deltaSeconds: number;
  source: StreamCursorSource;
  predicted(aheadSeconds: number): { x: number; z: number };
}

export interface StreamCursorInput {
  frameId: number;
  deltaSeconds: number;
  interactionMode: string;
  player: { spawned: boolean; position: { x: number; z: number } };
  camera: { position: { x: number; z: number } };
  orbitTarget: { x: number; z: number };
  cameraRelativeWorld: boolean;
}

export interface CanonicalStreamCenter {
  center: { x: number; z: number };
  source: StreamCursorSource;
}

const MAX_VELOCITY_MPS = 500;
// Matches the former 0.85-per-60-Hz-frame response while remaining stable across frame rates.
const VELOCITY_EMA_TIME_CONSTANT_SECONDS = -(1 / 60) / Math.log(0.85);

export const STREAM_CURSOR_SOURCE_CODE: Record<StreamCursorSource, number> = {
  playing_player: 1,
  orbit_spawned_player: 2,
  orbit_camera: 3,
  orbit_target: 4,
};

export function canonicalStreamCenter(input: StreamCursorInput): CanonicalStreamCenter {
  if (input.interactionMode === "playing") {
    return {
      center: { x: input.player.position.x, z: input.player.position.z },
      source: "playing_player",
    };
  }
  if (input.cameraRelativeWorld) {
    if (input.player.spawned) {
      return {
        center: { x: input.player.position.x, z: input.player.position.z },
        source: "orbit_spawned_player",
      };
    }
    return {
      center: { x: input.camera.position.x, z: input.camera.position.z },
      source: "orbit_camera",
    };
  }
  return {
    center: { x: input.orbitTarget.x, z: input.orbitTarget.z },
    source: "orbit_target",
  };
}

export class StreamCursorTracker {
  private previousCenter: { x: number; z: number } | null = null;
  private velocity = { x: 0, z: 0 };

  update(input: StreamCursorInput): StreamCursor {
    const canonical = canonicalStreamCenter(input);
    const dt = Number.isFinite(input.deltaSeconds) ? Math.max(0, input.deltaSeconds) : 0;
    if (this.previousCenter && dt > 0.001) {
      const rawX = (canonical.center.x - this.previousCenter.x) / dt;
      const rawZ = (canonical.center.z - this.previousCenter.z) / dt;
      const alpha = 1 - Math.exp(-dt / VELOCITY_EMA_TIME_CONSTANT_SECONDS);
      this.velocity.x += (rawX - this.velocity.x) * alpha;
      this.velocity.z += (rawZ - this.velocity.z) * alpha;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > MAX_VELOCITY_MPS) {
        const scale = MAX_VELOCITY_MPS / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    this.previousCenter = { ...canonical.center };
    const center = { ...canonical.center };
    const velocityMps = { ...this.velocity };
    return {
      frameId: input.frameId,
      center,
      velocityMps,
      deltaSeconds: dt,
      source: canonical.source,
      predicted(aheadSeconds) {
        const ahead = Number.isFinite(aheadSeconds) ? Math.max(0, aheadSeconds) : 0;
        return {
          x: center.x + velocityMps.x * ahead,
          z: center.z + velocityMps.z * ahead,
        };
      },
    };
  }
}

export function publishStreamCursorCounters(
  counters: Record<string, number> | undefined,
  cursor: StreamCursor,
): void {
  if (!counters) return;
  counters["stream_cursor_x"] = cursor.center.x;
  counters["stream_cursor_z"] = cursor.center.z;
  counters["stream_cursor_speed_mps"] = Math.hypot(cursor.velocityMps.x, cursor.velocityMps.z);
  counters["stream_cursor_velocity_x_mps"] = cursor.velocityMps.x;
  counters["stream_cursor_velocity_z_mps"] = cursor.velocityMps.z;
  counters["stream_cursor_source"] = STREAM_CURSOR_SOURCE_CODE[cursor.source];
}
