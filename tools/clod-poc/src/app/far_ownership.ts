// Terrain-ownership contract.
//
// The world is owned in radial bands by different renderers, historically selected by scattered,
// implicit conditions. This module makes ownership explicit and enforces the invariants that
// matter, on top of the radial seam that resolveStreamingOwnership() already guarantees
// (streamed CLOD owns near/mid; the far owner starts at farShellInnerM >= clodRadiusM; both throw
// on a gap/overlap violation).
//
// Far renderers:
//  - legacy_far_shell   : finite shell built from the bootstrap terrain summary, centred on the
//                         startup world. Correct only for finite worlds.
//  - infinite_far_shell : player-centred shell sampling the procedural world source. Correct for
//                         infinite / long-view worlds.
//  - far_clipmap        : GPU clipmap rings; resolves overlap with near/streamed terrain per-cell
//                         via GPU ownership (an intentional transition band, not a bug). Disabled
//                         for `infinite-` scenes unless farClipmapMode=replace.

export type FarOwner = "legacy_far_shell" | "far_clipmap" | "infinite_far_shell" | "none";
export type NearOwner = "streamed_clod" | "startup_clod";

export interface FarOwnerInput {
  isInfinite: boolean;
  /** isLongViewCapableScene(scene): these scenes build the player-centred InfiniteFarShell and the
   *  bootstrap disables the legacy finite shell for them. */
  longViewCapable: boolean;
  farClipmapRequested: boolean;
  /** farClipmapRendererAllowed(searchParams): false for `infinite-` scenes unless replace mode. */
  farClipmapRendererAllowed: boolean;
}

/**
 * The primary far-band owner (used for the HUD label and the legacy-shell disable decision).
 * Long-view scenes hand the far band to the InfiniteFarShell regardless of the finite/infinite
 * terrain flag, because the bootstrap disables the legacy shell for every long-view-capable scene —
 * unless the far clipmap is requested and allowed to render, in which case the bootstrap keeps the
 * shell out of the scene entirely and the clipmap is the sole far owner.
 */
export function resolveFarOwner(input: FarOwnerInput): FarOwner {
  const clipmapActive = input.farClipmapRequested && input.farClipmapRendererAllowed;
  if (input.longViewCapable) return clipmapActive ? "far_clipmap" : "infinite_far_shell";
  if (!input.isInfinite) return "legacy_far_shell";
  if (clipmapActive) return "far_clipmap";
  return "none";
}

export interface FarRendererActivity {
  legacyFarShell: boolean;
  infiniteFarShell: boolean;
  farClipmap: boolean;
}

/**
 * Count of forbidden concurrent far owners. The one hard invariant: the legacy finite far shell
 * (built from the bootstrap summary, centred on the startup world) must never render alongside the
 * player-centred infinite far shell — that is the finite ring near the origin z-fighting, and
 * disagreeing on height with, the real player-centred far terrain. (InfiniteFarShell + far clipmap,
 * or legacy shell + clipmap on finite worlds, may legitimately layer via GPU per-cell ownership.)
 */
export function farOwnershipOverlapViolations(activity: FarRendererActivity): number {
  return activity.legacyFarShell && activity.infiniteFarShell ? 1 : 0;
}

/** Throws when the legacy finite far shell is active alongside the infinite far shell. */
export function assertLegacyFarShellExclusive(activity: FarRendererActivity): void {
  if (farOwnershipOverlapViolations(activity) > 0) {
    throw new Error(
      "Legacy finite far shell is active alongside the player-centred infinite far shell; " +
        "disable the legacy far shell when an infinite far owner is present.",
    );
  }
}

export interface FarOwnershipSummary {
  nearOwner: NearOwner;
  farOwner: FarOwner;
  /** Handoff band [inner, outer]: near owns up to `inner`, far owns from `outer`. Between them the
   *  streamed CLOD and far owner crossfade. Zero-width (inner===outer) when not a streaming scene. */
  transitionInnerM: number;
  transitionOuterM: number;
  farOuterM: number;
  overlapViolations: number;
}

export interface FarOwnershipSummaryInput {
  farOwner: FarOwner;
  streamingScene: boolean;
  activity: FarRendererActivity;
  /** Streamed CLOD coverage outer radius — the near/mid owner ends here. */
  clodRadiusM?: number;
  /** Far band inner radius (resolveStreamingOwnership guarantees >= clodRadiusM). */
  farInnerM?: number;
  farOuterM?: number;
}

export function buildFarOwnershipSummary(input: FarOwnershipSummaryInput): FarOwnershipSummary {
  const transitionInnerM = Math.max(0, input.clodRadiusM ?? 0);
  const transitionOuterM = Math.max(transitionInnerM, input.farInnerM ?? transitionInnerM);
  return {
    nearOwner: input.streamingScene ? "streamed_clod" : "startup_clod",
    farOwner: input.farOwner,
    transitionInnerM,
    transitionOuterM,
    farOuterM: Math.max(transitionOuterM, input.farOuterM ?? 0),
    overlapViolations: farOwnershipOverlapViolations(input.activity),
  };
}

/** Compact overlay: `near=streamed_clod transition=384-512m far=infinite_far_shell overlap=0`. */
export function formatFarOwnershipOverlay(summary: FarOwnershipSummary): string {
  const transition = summary.transitionOuterM > summary.transitionInnerM
    ? `${Math.round(summary.transitionInnerM)}-${Math.round(summary.transitionOuterM)}m`
    : "none";
  return `near=${summary.nearOwner} transition=${transition} far=${summary.farOwner} overlap=${summary.overlapViolations}`;
}
