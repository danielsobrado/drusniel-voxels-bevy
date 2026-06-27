// Viewer-facing overlay model for the Fable-style terrain shadow cut.
//
// shadow_clod.ts selects the caster cut and shadow_manifest.ts gives the
// runtime/export contract.  This module keeps the debug viewer deterministic:
// it converts manifest entries into stable colours, labels, filters, and
// aggregate counters without importing Three.js.

import type {
  RuntimeShadowPolicy,
  ShadowManifest,
  ShadowManifestBounds,
  ShadowManifestEntry,
  ShadowManifestFootprint,
} from "./shadow_manifest.js";

export type ShadowOverlayMode = "off" | "casters" | "all";

export interface ShadowOverlayOptions {
  /** off hides everything, casters hides NoCast, all includes NoCast pages. */
  mode?: ShadowOverlayMode;
  /** Dim culled pages so caster policies remain readable when all pages show. */
  noCastOpacity?: number;
}

export interface ShadowOverlayEntry {
  nodeId: string;
  level: number;
  policy: RuntimeShadowPolicy;
  reason: ShadowManifestEntry["reason"];
  label: string;
  color: number;
  opacity: number;
  distance: number | null;
  triangleCount: number;
  shadowTriangleBudget: number;
  footprint: ShadowManifestFootprint;
  bounds: ShadowManifestBounds;
}

export interface ShadowOverlaySummary {
  totalPages: number;
  casterPages: number;
  visualPages: number;
  proxyPages: number;
  noCastPages: number;
  visualTriangles: number;
  shadowTrianglesBudgeted: number;
  savedTriangles: number;
  savingsRatio: number;
  maxCasterDistance: number;
  policySummary: string;
}

export interface ShadowOverlayModel {
  mode: ShadowOverlayMode;
  entries: ShadowOverlayEntry[];
  summary: ShadowOverlaySummary;
}

const DEFAULT_OPTIONS: Required<ShadowOverlayOptions> = {
  mode: "casters",
  noCastOpacity: 0.22,
};

const POLICY_COLOURS: Record<RuntimeShadowPolicy, number> = {
  VisualMesh: 0xf6b73c,
  ClodShadowMesh: 0x42c7ff,
  NoCast: 0x6b7280,
};

export function shadowPolicyColor(policy: RuntimeShadowPolicy): number {
  return POLICY_COLOURS[policy];
}

export function shadowPolicyShortName(policy: RuntimeShadowPolicy): string {
  switch (policy) {
    case "VisualMesh":
      return "visual";
    case "ClodShadowMesh":
      return "proxy";
    case "NoCast":
      return "none";
  }
}

function policyOpacity(policy: RuntimeShadowPolicy, noCastOpacity: number): number {
  return policy === "NoCast" ? noCastOpacity : 1;
}

function labelFor(entry: ShadowManifestEntry): string {
  const parts = [
    entry.nodeId,
    `L${entry.level}`,
    shadowPolicyShortName(entry.policy),
  ];
  if (entry.distance != null) parts.push(`${entry.distance.toFixed(1)}m`);
  if (entry.shadowTriangleBudget > 0) parts.push(`${entry.shadowTriangleBudget} shadow tris`);
  return parts.join(" · ");
}

function entryToOverlay(entry: ShadowManifestEntry, options: Required<ShadowOverlayOptions>): ShadowOverlayEntry {
  return {
    nodeId: entry.nodeId,
    level: entry.level,
    policy: entry.policy,
    reason: entry.reason,
    label: labelFor(entry),
    color: shadowPolicyColor(entry.policy),
    opacity: policyOpacity(entry.policy, options.noCastOpacity),
    distance: entry.distance,
    triangleCount: entry.triangleCount,
    shadowTriangleBudget: entry.shadowTriangleBudget,
    footprint: { ...entry.footprint },
    bounds: {
      center: [...entry.bounds.center] as [number, number, number],
      radius: entry.bounds.radius,
    },
  };
}

function shouldInclude(entry: ShadowManifestEntry, mode: ShadowOverlayMode): boolean {
  if (mode === "off") return false;
  if (mode === "casters") return entry.policy !== "NoCast";
  return true;
}

function policySummary(visualPages: number, proxyPages: number, noCastPages: number): string {
  return `visual:${visualPages} proxy:${proxyPages} none:${noCastPages}`;
}

function buildSummary(manifest: ShadowManifest): ShadowOverlaySummary {
  const visualTriangles = manifest.entries.reduce((sum, entry) => sum + entry.triangleCount, 0);
  const shadowTrianglesBudgeted = manifest.entries.reduce(
    (sum, entry) => sum + entry.shadowTriangleBudget,
    0,
  );
  const savedTriangles = Math.max(0, visualTriangles - shadowTrianglesBudgeted);
  const savingsRatio = visualTriangles > 0 ? savedTriangles / visualTriangles : 0;

  return {
    totalPages: manifest.totals.totalPages,
    casterPages: manifest.totals.casterPages,
    visualPages: manifest.totals.visualPages,
    proxyPages: manifest.totals.proxyPages,
    noCastPages: manifest.totals.noCastPages,
    visualTriangles,
    shadowTrianglesBudgeted,
    savedTriangles,
    savingsRatio,
    maxCasterDistance: manifest.totals.maxCasterDistance,
    policySummary: policySummary(
      manifest.totals.visualPages,
      manifest.totals.proxyPages,
      manifest.totals.noCastPages,
    ),
  };
}

export function buildShadowOverlayModel(
  manifest: ShadowManifest,
  userOptions: ShadowOverlayOptions = {},
): ShadowOverlayModel {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const entries = manifest.entries
    .filter((entry) => shouldInclude(entry, options.mode))
    .map((entry) => entryToOverlay(entry, options))
    .sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId));

  return {
    mode: options.mode,
    entries,
    summary: buildSummary(manifest),
  };
}
