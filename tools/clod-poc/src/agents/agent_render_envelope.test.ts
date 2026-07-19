import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createAgentRenderEnvelope, createSharedWalkClip } from "./agent_render_envelope.js";

describe("agent render envelope skinned clips", () => {
  it("binds the shared walk clip to named bones on every instance", () => {
    const scene = new THREE.Scene();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const envelope = createAgentRenderEnvelope(scene, {
        count: 3,
        seed: 1,
        centerX: 0,
        centerZ: 0,
        spreadM: 8,
        skinned: true,
      });
      const clip = createSharedWalkClip();
      expect(clip.tracks[0]?.name).toBe("agentUpper.position[y]");
      envelope.update(1 / 60, {});
      envelope.update(1 / 60, {});
      expect(warnings.some((warning) => warning.includes("PropertyBinding"))).toBe(false);
      envelope.dispose();
    } finally {
      console.warn = originalWarn;
    }
  });
});
