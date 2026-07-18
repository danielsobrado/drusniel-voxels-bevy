import { beforeEach, describe, expect, it } from "vitest";
import {
  StreamCursorTracker,
  canonicalStreamCenter,
  installStreamCursorPrimeTarget,
  markStreamCursorDiscontinuity,
  resetStreamCursorMovementEpochForTests,
} from "./stream_cursor.js";

const baseInput = {
  frameId: 1,
  deltaSeconds: 1 / 60,
  interactionMode: "orbit" as const,
  player: { spawned: true, position: { x: 10, z: 20 } },
  camera: { position: { x: 30, z: 40 } },
  orbitTarget: { x: 50, z: 60 },
  cameraRelativeWorld: false,
};

beforeEach(() => resetStreamCursorMovementEpochForTests());

describe("canonicalStreamCenter", () => {
  it("keeps canonical center semantics for every interaction mode", () => {
    expect(canonicalStreamCenter({ ...baseInput, interactionMode: "playing" })).toEqual({
      center: { x: 10, z: 20 },
      source: "playing_player",
    });
    expect(canonicalStreamCenter({ ...baseInput, cameraRelativeWorld: true })).toEqual({
      center: { x: 10, z: 20 },
      source: "orbit_spawned_player",
    });
    expect(canonicalStreamCenter({
      ...baseInput,
      cameraRelativeWorld: true,
      player: { ...baseInput.player, spawned: false },
    })).toEqual({ center: { x: 30, z: 40 }, source: "orbit_camera" });
    expect(canonicalStreamCenter(baseInput)).toEqual({
      center: { x: 50, z: 60 },
      source: "orbit_target",
    });
  });

  it("primes playing-mode streaming without mutating the player position", () => {
    const playerPosition = { x: 10, z: 20 };
    const input = {
      ...baseInput,
      interactionMode: "playing" as const,
      player: { spawned: true, position: playerPosition },
    };
    const release = installStreamCursorPrimeTarget({ x: 2_048, z: -1_024 });

    expect(canonicalStreamCenter(input)).toEqual({
      center: { x: 2_048, z: -1_024 },
      source: "playing_teleport_prime",
    });
    expect(playerPosition).toEqual({ x: 10, z: 20 });

    release();
    expect(canonicalStreamCenter(input)).toEqual({
      center: { x: 10, z: 20 },
      source: "playing_player",
    });
  });

  it("keeps the newest overlapping prime active when an older lease disposes", () => {
    const input = { ...baseInput, interactionMode: "playing" as const };
    const releaseFirst = installStreamCursorPrimeTarget({ x: 100, z: 200 });
    const releaseSecond = installStreamCursorPrimeTarget({ x: 300, z: 400 });

    releaseFirst();
    expect(canonicalStreamCenter(input).center).toEqual({ x: 300, z: 400 });

    releaseSecond();
    expect(canonicalStreamCenter(input).center).toEqual({ x: 10, z: 20 });
  });

  it("rejects non-finite stream-prime targets", () => {
    expect(() => installStreamCursorPrimeTarget({ x: Number.NaN, z: 0 })).toThrow(/must be finite/);
  });
});

describe("StreamCursorTracker", () => {
  function trackAt(fps: number) {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, deltaSeconds: 1 / fps, orbitTarget: { x: 0, z: 0 } });
    let cursor = tracker.update({ ...baseInput, frameId: 1, deltaSeconds: 1 / fps, orbitTarget: { x: 0, z: 0 } });
    for (let frame = 1; frame <= fps; frame++) {
      cursor = tracker.update({
        ...baseInput,
        frameId: frame + 1,
        deltaSeconds: 1 / fps,
        orbitTarget: { x: frame * (12 / fps), z: 0 },
      });
    }
    return cursor;
  }

  it("predicts the same physical motion at 30 fps and 60 fps", () => {
    const at30 = trackAt(30);
    const at60 = trackAt(60);

    expect(at30.velocityMps.x).toBeCloseTo(at60.velocityMps.x, 1);
    expect(at30.predicted(4).x).toBeCloseTo(at60.predicted(4).x, 0);
  });

  it("resets velocity when the canonical source changes", () => {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, orbitTarget: { x: 0, z: 0 } });
    tracker.update({ ...baseInput, frameId: 1, orbitTarget: { x: 1, z: 0 } });

    const cursor = tracker.update({
      ...baseInput,
      frameId: 2,
      interactionMode: "playing",
      player: { spawned: true, position: { x: 100, z: 100 } },
    });

    expect(cursor.discontinuity).toBe(true);
    expect(cursor.velocityMps).toEqual({ x: 0, z: 0 });
    expect(cursor.predicted(4)).toEqual(cursor.center);
  });

  it("resets velocity when an explicit movement epoch changes", () => {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, movementEpoch: 7, orbitTarget: { x: 0, z: 0 } });
    tracker.update({ ...baseInput, frameId: 1, movementEpoch: 7, orbitTarget: { x: 1, z: 0 } });

    const cursor = tracker.update({
      ...baseInput,
      frameId: 2,
      movementEpoch: 8,
      orbitTarget: { x: 2, z: 0 },
    });

    expect(cursor.discontinuity).toBe(true);
    expect(cursor.velocityMps).toEqual({ x: 0, z: 0 });
    expect(cursor.predicted(4)).toEqual(cursor.center);
  });

  it("observes the global discontinuity signal", () => {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, orbitTarget: { x: 0, z: 0 } });
    tracker.update({ ...baseInput, frameId: 1, orbitTarget: { x: 1, z: 0 } });
    markStreamCursorDiscontinuity();

    const cursor = tracker.update({ ...baseInput, frameId: 2, orbitTarget: { x: 2, z: 0 } });

    expect(cursor.discontinuity).toBe(true);
    expect(cursor.velocityMps).toEqual({ x: 0, z: 0 });
  });

  it("treats prime installation and release as discontinuities", () => {
    const tracker = new StreamCursorTracker();
    const playingInput = { ...baseInput, interactionMode: "playing" as const };
    tracker.update({ ...playingInput, frameId: 0 });

    const release = installStreamCursorPrimeTarget({ x: 1_000, z: 1_000 });
    const primed = tracker.update({ ...playingInput, frameId: 1 });
    expect(primed.discontinuity).toBe(true);
    expect(primed.velocityMps).toEqual({ x: 0, z: 0 });

    release();
    const restored = tracker.update({ ...playingInput, frameId: 2 });
    expect(restored.discontinuity).toBe(true);
    expect(restored.center).toEqual({ x: 10, z: 20 });
  });

  it("treats a medium one-frame relocation as a discontinuity", () => {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, orbitTarget: { x: 0, z: 0 } });
    const cursor = tracker.update({ ...baseInput, frameId: 1, orbitTarget: { x: 50, z: 0 } });

    expect(cursor.discontinuity).toBe(true);
    expect(cursor.velocityMps).toEqual({ x: 0, z: 0 });
  });

  it("treats a floating-origin-sized coordinate jump as a discontinuity", () => {
    const tracker = new StreamCursorTracker();
    tracker.update({ ...baseInput, frameId: 0, orbitTarget: { x: 4100, z: 0 } });
    const cursor = tracker.update({ ...baseInput, frameId: 1, orbitTarget: { x: 4, z: 0 } });

    expect(cursor.discontinuity).toBe(true);
    expect(cursor.velocityMps).toEqual({ x: 0, z: 0 });
    expect(tracker.discontinuityCount()).toBe(1);
  });
});
