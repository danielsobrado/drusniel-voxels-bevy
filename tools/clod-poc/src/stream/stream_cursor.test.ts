import { beforeEach, describe, expect, it } from "vitest";
import {
  StreamCursorTracker,
  canonicalStreamCenter,
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
