import { cloneWaterConfig, type WaterConfig } from "./waterConfig.js";

export const RIVER_PARITY_TEST_SCENE = "river-parity-test";

export function isRiverParityTestScene(scene: string | null | undefined): boolean {
  return scene === RIVER_PARITY_TEST_SCENE;
}

export function applyRiverParityTestWaterConfig(config: WaterConfig): WaterConfig {
  const next = cloneWaterConfig(config);
  next.enabled = true;
  next.source = "fake_bodies";
  next.fakeBodies.carveTerrain = true;
  next.fakeBodies.lakes = [
    {
      center: [0, 0],
      centerNorm: [0.70, 0.58],
      radius: [58, 38],
      levelOffset: 1.0,
    },
    {
      center: [0, 0],
      centerNorm: [0.30, 0.34],
      radius: [38, 26],
      levelOffset: 0.9,
    },
  ];
  next.fakeBodies.rivers = [
    {
      // Main validation river: straight headwater, curved middle, narrow rapid,
      // wide slow meander, lake inflow, lake outflow.
      points: [],
      pointsNorm: [
        [0.08, 0.24],
        [0.22, 0.24],
        [0.36, 0.30],
        [0.46, 0.43],
        [0.56, 0.50],
        [0.68, 0.56],
        [0.77, 0.60],
        [0.91, 0.68],
      ],
      width: 12.0,
      levelOffset: 1.0,
      downstreamDrop: 8.2,
    },
    {
      // Tributary: steep rapid test that joins the main river before the lake.
      points: [],
      pointsNorm: [
        [0.18, 0.82],
        [0.26, 0.70],
        [0.34, 0.58],
        [0.43, 0.48],
        [0.54, 0.50],
      ],
      width: 7.0,
      levelOffset: 1.15,
      downstreamDrop: 12.0,
    },
    {
      // Slow wide side channel for shallow edge / dark center comparisons.
      points: [],
      pointsNorm: [
        [0.14, 0.46],
        [0.28, 0.50],
        [0.42, 0.55],
        [0.58, 0.56],
      ],
      width: 18.0,
      levelOffset: 0.95,
      downstreamDrop: 2.2,
    },
  ];

  next.visual.rippleAmp = Math.max(next.visual.rippleAmp, 1.45);
  next.visual.rippleStrengthA = Math.max(next.visual.rippleStrengthA, 0.28);
  next.visual.rippleStrengthB = Math.max(next.visual.rippleStrengthB, 0.20);
  next.visual.foam.riverStrength = Math.max(next.visual.foam.riverStrength, 0.88);
  next.visual.foam.shoreStrength = Math.max(next.visual.foam.shoreStrength, 0.66);
  next.visual.foam.speedStart = Math.min(next.visual.foam.speedStart, 0.14);
  next.visual.foam.speedEnd = Math.min(next.visual.foam.speedEnd, 0.74);
  next.visual.foam.dropStart = Math.min(next.visual.foam.dropStart, 0.16);
  next.visual.foam.dropEnd = Math.min(next.visual.foam.dropEnd, 1.20);
  next.visual.color.depthScale = Math.min(next.visual.color.depthScale, 4.2);
  next.visual.color.turbidity = Math.max(next.visual.color.turbidity, 0.14);
  next.visual.fresnel.normalFlatten = Math.min(next.visual.fresnel.normalFlatten, 0.45);
  return next;
}
