import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildFarTerrainShell, type FarShellLighting } from "./far_terrain_shell.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";

const lighting: FarShellLighting = {
  sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.85),
  skyLight: new THREE.Color(0.4, 0.5, 0.65),
  groundLight: new THREE.Color(0.2, 0.18, 0.14),
};

describe("far terrain shell — horizon skirt around the world", () => {
  const worldSize = 100;
  // Empty page set → every summary cell falls back to the analytic field; the skirt is what we
  // are testing, not page coverage.
  const summary = buildTerrainSummary([], worldSize, 8);
  const inset = worldSize * 0.04; // matches the buildFarTerrainShell default
  const shell = buildFarTerrainShell(summary, lighting, { gridRes: 32 });

  const index = shell.mesh.geometry.getIndex();
  const position = shell.mesh.geometry.getAttribute("position");

  function expectNoTriangleFullyInsidePageOwnedInterior(idx: THREE.BufferAttribute, pos: THREE.BufferAttribute): void {
    const insideInterior = (vi: number): boolean => {
      const x = pos.getX(vi);
      const z = pos.getZ(vi);
      return x > inset && x < worldSize - inset && z > inset && z < worldSize - inset;
    };
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const allInside = insideInterior(a) && insideInterior(b) && insideInterior(c);
      expect(allInside).toBe(false);
    }
  }

  it("emits a non-empty skirt mesh", () => {
    expect(index).not.toBeNull();
    expect(shell.triangleCount).toBeGreaterThan(0);
    expect(index!.count).toBe(shell.triangleCount * 3);
  });

  it("excludes the page-owned world interior: no triangle lies fully inside [inset, worldSize-inset]²", () => {
    expectNoTriangleFullyInsidePageOwnedInterior(index!, position as THREE.BufferAttribute);
  });

  it("keeps finite-world interior exclusion even when a height provider is present", () => {
    const providerShell = buildFarTerrainShell(summary, lighting, {
      gridRes: 32,
      heightProvider: {
        sampleHeight: () => 0,
        sampleNormal: () => new THREE.Vector3(0, 1, 0),
      },
    });

    expectNoTriangleFullyInsidePageOwnedInterior(
      providerShell.mesh.geometry.getIndex()!,
      providerShell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute,
    );
    providerShell.dispose();
  });

  it("extends beyond the world edge (some vertices lie past worldSize)", () => {
    let beyond = 0;
    for (let vi = 0; vi < position.count; vi++) {
      const x = position.getX(vi);
      const z = position.getZ(vi);
      if (x > worldSize || z > worldSize || x < 0 || z < 0) beyond++;
    }
    expect(beyond).toBeGreaterThan(0);
  });

  it("keeps TSL far-shell material when sun shadows are enabled unless debug Lambert is requested", () => {
    const withShadows = buildFarTerrainShell(summary, lighting, {
      gridRes: 32,
      receiveSunShadows: true,
      useDebugLambertReceiver: false,
    });
    const withShadowsMaterial = Array.isArray(withShadows.mesh.material)
      ? withShadows.mesh.material[0]!
      : withShadows.mesh.material;
    expect(withShadowsMaterial.type).not.toBe("MeshLambertMaterial");
    expect(withShadows.mesh.receiveShadow).toBe(true);

    const debugLambert = buildFarTerrainShell(summary, lighting, {
      gridRes: 32,
      receiveSunShadows: true,
      useDebugLambertReceiver: true,
    });
    const debugLambertMaterial = Array.isArray(debugLambert.mesh.material)
      ? debugLambert.mesh.material[0]!
      : debugLambert.mesh.material;
    expect(debugLambertMaterial.type).toBe("MeshLambertMaterial");
    debugLambert.dispose();
    withShadows.dispose();
  });

  it("uses a camera-relative radial exclusion when a streaming height provider is active", () => {
    const innerRadius = 60;
    const farRadius = 150;
    const radialShell = buildFarTerrainShell(summary, lighting, {
      gridRes: 32,
      farRadius,
      centerX: 25,
      centerZ: -40,
      buildRelative: true,
      innerExclusionRadius: innerRadius,
      heightProvider: {
        sampleHeight: () => 0,
        sampleNormal: () => new THREE.Vector3(0, 1, 0),
      },
    });

    const radialIndex = radialShell.mesh.geometry.getIndex()!;
    const radialPosition = radialShell.mesh.geometry.getAttribute("position");
    const fullGridTriangles = 32 * 32 * 2;

    expect(radialShell.triangleCount).toBeGreaterThan(0);
    expect(radialShell.triangleCount).toBeLessThan(fullGridTriangles);

    const insideInner = (vi: number): boolean => {
      const x = radialPosition.getX(vi);
      const z = radialPosition.getZ(vi);
      return Math.hypot(x, z) < innerRadius;
    };

    for (let t = 0; t < radialIndex.count; t += 3) {
      const a = radialIndex.getX(t);
      const b = radialIndex.getX(t + 1);
      const c = radialIndex.getX(t + 2);
      const allInside = insideInner(a) && insideInner(b) && insideInner(c);
      expect(allInside).toBe(false);
    }

    radialShell.dispose();
  });

  it("falls back to finite heights when the streaming height provider returns bad samples", () => {
    const badProviderShell = buildFarTerrainShell(summary, lighting, {
      gridRes: 16,
      farRadius: 150,
      centerX: 25,
      centerZ: -40,
      buildRelative: true,
      innerExclusionRadius: 60,
      heightProvider: {
        sampleHeight: (x) => {
          if (x < 0) throw new Error("missing tile");
          return Number.NaN;
        },
        sampleNormal: () => new THREE.Vector3(0, 1, 0),
      },
    });

    const badPosition = badProviderShell.mesh.geometry.getAttribute("position");
    for (let vi = 0; vi < badPosition.count; vi++) {
      expect(Number.isFinite(badPosition.getY(vi))).toBe(true);
    }
    badProviderShell.dispose();
  });
});
