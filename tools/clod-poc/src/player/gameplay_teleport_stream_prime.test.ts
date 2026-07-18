import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalStreamCenter,
  resetStreamCursorMovementEpochForTests,
} from "../stream/stream_cursor.js";
import { runStreamPrimedGameplayTeleport } from "./gameplay_teleport_stream_prime.js";

const streamInput = (player: { x: number; z: number }) => ({
  frameId: 1,
  deltaSeconds: 1 / 60,
  interactionMode: "playing",
  player: { spawned: true, position: player },
  camera: { position: { x: player.x, z: player.z } },
  orbitTarget: { x: player.x, z: player.z },
  cameraRelativeWorld: true,
});

beforeEach(() => resetStreamCursorMovementEpochForTests());

describe("runStreamPrimedGameplayTeleport", () => {
  it("streams the destination while player authority remains at the source", async () => {
    const player = { x: 10, z: 20 };
    const target = { x: 2_048, z: -1_024 };
    let ready = false;
    let suspended = 0;
    const commit = vi.fn((next: typeof target) => {
      player.x = next.x;
      player.z = next.z;
    });

    const result = await runStreamPrimedGameplayTeleport({
      target,
      timeoutMs: 1_000,
      commit,
      readyAt: () => ready,
      waitFrame: async () => {
        expect(player).toEqual({ x: 10, z: 20 });
        expect(canonicalStreamCenter(streamInput(player))).toEqual({
          center: target,
          source: "playing_teleport_prime",
        });
        ready = true;
      },
      now: () => 100,
      recordReadyMs: vi.fn(),
      suspendGameplay: () => {
        suspended += 1;
        return () => { suspended -= 1; };
      },
    });

    expect(result.readinessPolls).toBe(3);
    expect(commit).toHaveBeenCalledOnce();
    expect(player).toEqual(target);
    expect(suspended).toBe(0);
    expect(canonicalStreamCenter(streamInput(player))).toEqual({
      center: target,
      source: "playing_player",
    });
  });

  it("clears the stream prime and resumes gameplay after timeout", async () => {
    const player = { x: 10, z: 20 };
    let now = 0;
    let suspended = 0;

    await expect(runStreamPrimedGameplayTeleport({
      target: { x: 500, z: 600 },
      timeoutMs: 10,
      commit: vi.fn(),
      readyAt: () => false,
      waitFrame: async () => { now = 11; },
      now: () => now,
      recordReadyMs: vi.fn(),
      suspendGameplay: () => {
        suspended += 1;
        return () => { suspended -= 1; };
      },
    })).rejects.toThrow(/timed out/);

    expect(player).toEqual({ x: 10, z: 20 });
    expect(suspended).toBe(0);
    expect(canonicalStreamCenter(streamInput(player))).toEqual({
      center: { x: 10, z: 20 },
      source: "playing_player",
    });
  });

  it("does not install a prime when the target is already ready", async () => {
    const player = { x: 1, z: 2 };
    const commit = vi.fn();
    const waitFrame = vi.fn(async () => undefined);

    await runStreamPrimedGameplayTeleport({
      target: { x: 3, z: 4 },
      timeoutMs: 100,
      commit,
      readyAt: () => true,
      waitFrame,
      now: () => 0,
      recordReadyMs: vi.fn(),
    });

    expect(commit).toHaveBeenCalledOnce();
    expect(waitFrame).not.toHaveBeenCalled();
    expect(canonicalStreamCenter(streamInput(player)).source).toBe("playing_player");
  });
});
