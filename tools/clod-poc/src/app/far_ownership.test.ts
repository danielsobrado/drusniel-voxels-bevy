import { describe, expect, it } from "vitest";
import {
  assertLegacyFarShellExclusive,
  buildFarOwnershipSummary,
  farOwnershipOverlapViolations,
  formatFarOwnershipOverlay,
  resolveFarOwner,
} from "./far_ownership.js";

describe("resolveFarOwner", () => {
  it("hands the far band to the infinite shell for long-view-capable scenes", () => {
    expect(resolveFarOwner({
      isInfinite: true, longViewCapable: true, farClipmapRequested: true, farClipmapRendererAllowed: false,
    })).toBe("infinite_far_shell");
    // Even a finite long-view scene: the bootstrap disables the legacy shell for it.
    expect(resolveFarOwner({
      isInfinite: false, longViewCapable: true, farClipmapRequested: false, farClipmapRendererAllowed: true,
    })).toBe("infinite_far_shell");
  });

  it("keeps finite non-long-view worlds on the legacy far shell", () => {
    expect(resolveFarOwner({
      isInfinite: false, longViewCapable: false, farClipmapRequested: false, farClipmapRendererAllowed: true,
    })).toBe("legacy_far_shell");
  });

  it("uses the clipmap only when requested and actually allowed to render", () => {
    expect(resolveFarOwner({
      isInfinite: true, longViewCapable: false, farClipmapRequested: true, farClipmapRendererAllowed: true,
    })).toBe("far_clipmap");
    expect(resolveFarOwner({
      isInfinite: true, longViewCapable: false, farClipmapRequested: true, farClipmapRendererAllowed: false,
    })).toBe("none");
  });
});

describe("far ownership invariant", () => {
  it("flags the legacy finite shell rendering alongside the infinite shell", () => {
    expect(farOwnershipOverlapViolations({ legacyFarShell: true, infiniteFarShell: true, farClipmap: false })).toBe(1);
    expect(() => assertLegacyFarShellExclusive({ legacyFarShell: true, infiniteFarShell: true, farClipmap: false }))
      .toThrow(/legacy finite far shell/i);
  });

  it("allows the infinite shell and clipmap to co-exist (GPU per-cell ownership)", () => {
    expect(farOwnershipOverlapViolations({ legacyFarShell: false, infiniteFarShell: true, farClipmap: true })).toBe(0);
    expect(() => assertLegacyFarShellExclusive({ legacyFarShell: false, infiniteFarShell: true, farClipmap: true }))
      .not.toThrow();
  });

  it("allows the legacy shell and clipmap to co-exist on finite worlds", () => {
    expect(farOwnershipOverlapViolations({ legacyFarShell: true, infiniteFarShell: false, farClipmap: true })).toBe(0);
  });
});

describe("far ownership summary + overlay", () => {
  it("reports the streamed CLOD near owner and the seam handoff band", () => {
    const summary = buildFarOwnershipSummary({
      farOwner: "infinite_far_shell",
      streamingScene: true,
      activity: { legacyFarShell: false, infiniteFarShell: true, farClipmap: false },
      clodRadiusM: 384,
      farInnerM: 512,
      farOuterM: 4096,
    });
    expect(summary.nearOwner).toBe("streamed_clod");
    expect(summary.transitionInnerM).toBe(384);
    expect(summary.transitionOuterM).toBe(512);
    expect(summary.overlapViolations).toBe(0);
    expect(formatFarOwnershipOverlay(summary)).toBe(
      "near=streamed_clod transition=384-512m far=infinite_far_shell overlap=0",
    );
  });

  it("uses the startup CLOD near owner and no transition band for finite worlds", () => {
    const summary = buildFarOwnershipSummary({
      farOwner: "legacy_far_shell",
      streamingScene: false,
      activity: { legacyFarShell: true, infiniteFarShell: false, farClipmap: false },
    });
    expect(summary.nearOwner).toBe("startup_clod");
    expect(formatFarOwnershipOverlay(summary)).toBe(
      "near=startup_clod transition=none far=legacy_far_shell overlap=0",
    );
  });
});
