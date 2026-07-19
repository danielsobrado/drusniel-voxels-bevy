export * from "./grass_node_material_types.js";
export * from "./grass_node_material_defaults.js";
export * from "./grass_node_material_geometry.js";

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  cos,
  dot,
  float,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { sampleCarvedBedBilinearTsl, sampleHydrologyBilinearTsl } from "./placement_height.js";
import { DEFAULT_GRASS_SETTINGS } from "../grass.js";
import {
  grassContactInteractionNodes,
  grassContactPatchInfluence,
} from "../grass/grass_contact_patches.js";
import type { GrassNodeParams, GrassNodeMaterialHandle } from "./grass_node_material_types.js";

type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

function nrmComponent(axis: "x" | "y" | "z"): TslNode {
  const nrm: TslNode = normalGeometry;
  return nrm[axis];
}

function interleavedGradientNoise(p: TslNode): TslNode {
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189));
}

function grassRingBandMask(
  tier: TslNode,
  dist: TslNode,
  nearDistance: TslNode,
  midDistance: TslNode,
  farDistance: TslNode,
  bandDistance: TslNode,
): TslNode {
  const ign = interleavedGradientNoise(screenCoordinate);
  const fadeIn = (distance: TslNode): TslNode => smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist);
  const fadeOut = (distance: TslNode): TslNode => float(1).sub(smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist));
  const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade));
  const passOut = (fade: TslNode): TslNode => ign.lessThan(fade);
  const nearPass = tier.lessThan(0.5).and(passOut(fadeOut(nearDistance)));
  const midPass = tier.greaterThanEqual(0.5).and(tier.lessThan(1.5))
    .and(passIn(fadeIn(nearDistance))).and(passOut(fadeOut(midDistance)));
  const farPass = tier.greaterThanEqual(1.5).and(tier.lessThan(2.5))
    .and(passIn(fadeIn(midDistance))).and(passOut(fadeOut(farDistance)));
  const superPass = tier.greaterThanEqual(2.5).and(passIn(fadeIn(farDistance)));
  return nearPass.or(midPass).or(farPass).or(superPass);
}

const DEFAULT_APPEARANCE = {
  baseColor: [0.18, 0.34, 0.12] as const,
  tipColor: [0.30, 0.42, 0.14] as const,
  dryColor: [0.30, 0.24, 0.09] as const,
  normalPull: 1.0,
};

function normalizedWindDirection(direction: readonly number[] | undefined): THREE.Vector2 {
  const v = new THREE.Vector2(direction?.[0] ?? 0.8, direction?.[1] ?? 0.6);
  return v.lengthSq() > 1e-6 ? v.normalize() : v.set(1, 0);
}

export function createGrassNodeMaterial(params: GrassNodeParams): GrassNodeMaterialHandle {
  const appearance = params.appearance ?? DEFAULT_APPEARANCE;
  const uTime = uniform(0);
  const uBladeWidth = uniform(params.bladeWidth);
  const uWindStrength = uniform(params.windStrength);
  const uWindSpeed = uniform(params.windSpeed);
  const uGustStrength = uniform(params.gustStrength ?? 0.15);
  const uWindDir = uniform(normalizedWindDirection(params.windDirection));
  const uWindTurbulence = uniform(params.windTurbulence ?? 0.25);
  const uBaseColor = uniform(new THREE.Vector3(...appearance.baseColor));
  const uTipColor = uniform(new THREE.Vector3(...appearance.tipColor));
  const uDryColor = uniform(new THREE.Vector3(...appearance.dryColor));
  const uNormalPull = uniform(appearance.normalPull);
  const uFadeCenter = uniform(params.fadeCenter?.clone() ?? new THREE.Vector2());
  const ringSettings = params.ring ?? DEFAULT_GRASS_SETTINGS.ring;
  const lodSettings = params.lod ?? DEFAULT_GRASS_SETTINGS.lod;
  const distance = params.distance ?? DEFAULT_GRASS_SETTINGS.distance;
  const uNearDistance = uniform(Math.min(distance * lodSettings.nearFraction, ringSettings.nearMeters));
  const uMidDistance = uniform(Math.min(distance * lodSettings.midFraction, ringSettings.midMeters));
  const uFarDistance = uniform(Math.min(distance * ringSettings.farDistanceFraction, ringSettings.farMeters));
  const uBandDistance = uniform(ringSettings.bandMeters);
  const uLight = uniform(params.lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(params.lighting.sunColor));
  const uSky = uniform(v3(params.lighting.skyLight));
  const uGround = uniform(v3(params.lighting.groundLight));
  const isPatchV2 = params.mode === "terrain-patch-v2" || params.mode === "webgpu-ring-v1";
  let useAlphaToCoverage = isPatchV2 && params.alphaToCoverage === true;
  const debugAttributes = isPatchV2 && params.debugAttributes === true;

  const ring = params.ringInstanceBuffers;
  const uTierBaseOffset = uniform(params.tierBaseOffset ?? 0) as TslNode;
  let aOffset4: TslNode;
  let aPacked0: TslNode;
  let aPacked1: TslNode;
  let aTerrainNormal4: TslNode;
  if (ring) {
    const offsetStore: TslNode = storage(ring.offset, "vec4", ring.capacity).toReadOnly();
    const packed0Store: TslNode = storage(ring.packed0, "vec4", ring.capacity).toReadOnly();
    const packed1Store: TslNode = storage(ring.packed1, "vec4", ring.capacity).toReadOnly();
    const terrainNormalStore: TslNode = storage(ring.terrainNormal, "vec4", ring.capacity).toReadOnly();
    const storageIndex: TslNode = instanceIndex.add(uTierBaseOffset);
    aOffset4 = offsetStore.element(storageIndex);
    aPacked0 = packed0Store.element(storageIndex);
    aPacked1 = packed1Store.element(storageIndex);
    aTerrainNormal4 = terrainNormalStore.element(storageIndex);
  } else {
    aOffset4 = attribute("aOffset", "vec4");
    aPacked0 = attribute("aPacked0", "vec4");
    aPacked1 = attribute("aPacked1", "vec4");
    aTerrainNormal4 = attribute("aTerrainNormal", "vec4");
  }
  const aOffset: TslNode = aOffset4.xyz;
  let groundY: TslNode = aOffset.y;
  let hydroWaterY: TslNode | null = null;
  if (params.hydrologyWaterTexture) {
    const hydroSample = {
      texture: params.hydrologyWaterTexture,
      worldSize: params.worldSize ?? 1,
      res: params.hydrologyRes ?? 1,
    };
    const hydro: TslNode = sampleHydrologyBilinearTsl(aOffset.x, aOffset.z, hydroSample);
    hydroWaterY = hydro.x;
    groundY = sampleCarvedBedBilinearTsl(aOffset.x, aOffset.z, hydroSample);
  }
  const aTerrainNormal: TslNode = aTerrainNormal4.xyz;
  const aHeight: TslNode = aPacked0.x;
  const aRotY: TslNode = aPacked0.y;
  const aPhase: TslNode = aPacked0.z;
  const aColorMix: TslNode = aPacked0.w;
  const aWidthScale: TslNode = aPacked1.z;
  const aTier: TslNode = aPacked1.w;
  const uvY: TslNode = uv().y;
  const bend: TslNode = uvY.mul(uvY);
  const contact = grassContactPatchInfluence(vec2(aOffset.x, aOffset.z));
  const interaction = grassContactInteractionNodes();
  const effectiveHeight: TslNode = aHeight.mul(mix(1.0, interaction.minHeightScale, contact.suppress));
  const flattenedHeight: TslNode = effectiveHeight.mul(
    float(1).sub(contact.flatten.mul(interaction.flattenStrength).mul(uvY)),
  );
  const windTime: TslNode = uTime.mul(uWindSpeed);
  // World-space directional wind: the wave phase advances along uWindDir so gusts
  // roll across the field; per-blade phase only jitters, it does not steer.
  const alongWind: TslNode = aOffset.x.mul(uWindDir.x).add(aOffset.z.mul(uWindDir.y));
  const acrossWind: TslNode = aOffset.x.mul(uWindDir.y.negate()).add(aOffset.z.mul(uWindDir.x));
  const wavePhase: TslNode = alongWind.mul(0.22).sub(windTime).add(aPhase.mul(0.35));
  const gustTime: TslNode = windTime.add(aPhase).add(aOffset.x.mul(0.071)).add(aOffset.z.mul(0.053));
  const gustBase: TslNode = sin(gustTime.mul(0.13)).mul(0.5).add(0.5);
  const gustDetail: TslNode = sin(gustTime.mul(0.73).add(aOffset.x.mul(0.19).add(aOffset.z.mul(0.14)))).mul(0.5).add(0.5);
  const gust: TslNode = gustBase.mul(0.6).add(gustDetail.mul(0.4));
  const gustK: TslNode = aTerrainNormal4.w;
  const windAmp: TslNode = uWindStrength.mul(effectiveHeight).mul(bend).mul(uGustStrength.mul(gust).mul(gustK).add(1.0).sub(uGustStrength));
  const windWave: TslNode = sin(wavePhase).add(sin(wavePhase.mul(2.6).add(aPhase)).mul(0.35)).add(0.4);
  const windTurb: TslNode = sin(windTime.mul(1.9).add(aPhase.mul(2.0)).add(acrossWind.mul(0.31))).mul(uWindTurbulence);
  const directionalWindWorldX: TslNode = uWindDir.x.mul(windWave).sub(uWindDir.y.mul(windTurb)).mul(windAmp);
  const directionalWindWorldZ: TslNode = uWindDir.y.mul(windWave).add(uWindDir.x.mul(windTurb)).mul(windAmp);
  const splayAmp: TslNode = interaction.splayStrengthM.mul(contact.trample).mul(bend);
  const windWorldX: TslNode = directionalWindWorldX.add(contact.splay.x.mul(splayAmp));
  const windWorldZ: TslNode = directionalWindWorldZ.add(contact.splay.y.mul(splayAmp));
  // Counter-rotate into blade-local space so the later per-instance yaw restores
  // the world-space lean direction (all blades lean together).
  const c: TslNode = cos(aRotY);
  const s: TslNode = sin(aRotY);
  const wind: TslNode = vec2(
    c.mul(windWorldX).sub(s.mul(windWorldZ)),
    s.mul(windWorldX).add(c.mul(windWorldZ)),
  );
  let localX: TslNode;
  let localY: TslNode;
  let localZ: TslNode;
  let grassColor: TslNode;
  const pos: TslNode = positionGeometry;

  if (isPatchV2) {
    const edge: TslNode = clamp(aPacked1.x, 0.0, 1.0);
    const terrainNormal: TslNode = normalize(aTerrainNormal);
    const normalY: TslNode = clamp(terrainNormal.y, 0.0, 1.0);
    localX = pos.x.mul(uBladeWidth).mul(aWidthScale).add(wind.x);
    localY = pos.y.mul(flattenedHeight);
    localZ = pos.z.mul(uBladeWidth).mul(aWidthScale).add(wind.y);

    const mid = mix(uBaseColor, uTipColor, 0.5);
    grassColor = mix(uBaseColor, mid, smoothstep(0.0, 0.7, uvY));
    grassColor = mix(grassColor, uTipColor, smoothstep(0.62, 1.0, uvY));
    grassColor = mix(grassColor, uDryColor, aColorMix.mul(0.35));
    if (debugAttributes) {
      grassColor = vec3(edge, normalY, 0.08);
    }
  } else {
    localX = pos.x.mul(uBladeWidth).mul(aWidthScale).add(wind.x);
    localY = pos.y.mul(flattenedHeight);
    localZ = pos.z.mul(uBladeWidth).mul(aWidthScale).add(wind.y);

    const mid = mix(uBaseColor, uTipColor, 0.5);
    grassColor = mix(uBaseColor, mid, smoothstep(0.0, 0.62, uvY));
    grassColor = mix(grassColor, uTipColor, smoothstep(0.58, 1.0, uvY));
    grassColor = mix(grassColor, uDryColor, aColorMix.mul(0.48));
  }

  if (!debugAttributes) {
    const rootDirt: TslNode = contact.dirt
      .mul(interaction.dirtTintStrength)
      .mul(float(1).sub(smoothstep(0.2, 0.78, uvY)));
    grassColor = mix(grassColor, interaction.dirtColor, rootDirt);
  }

  const rotX: TslNode = c.mul(localX).add(s.mul(localZ));
  const rotZ: TslNode = s.mul(localX).negate().add(c.mul(localZ));
  const worldPos: TslNode = vec3(aOffset.x, groundY, aOffset.z).add(vec3(rotX, localY, rotZ));

  const localNormal: TslNode = normalize(
    vec3(nrmComponent("x").sub(wind.x.mul(0.35)), nrmComponent("y").add(bend.mul(0.16)), nrmComponent("z").sub(wind.y.mul(0.35))),
  );
  const bladeNormal: TslNode = normalize(
    vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
  );
  // Whole-blade pull toward the terrain normal (uNormalPull=1 shades the field
  // like a continuous ground surface); the true blade normal is kept separately
  // and only drives backlit transmission.
  const worldNormal: TslNode = normalize(mix(bladeNormal, normalize(aTerrainNormal), uNormalPull));

  const n: TslNode = frontFacing.select(worldNormal, worldNormal.negate());
  const bladeFacing: TslNode = frontFacing.select(bladeNormal, bladeNormal.negate());
  const lightDir: TslNode = uLight;
  const sun: TslNode = max(dot(n, lightDir), 0.0);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  const back: TslNode = max(dot(bladeFacing.negate(), lightDir), 0.0);
  let litColor: TslNode;
  if (isPatchV2) {
    const wrap: TslNode = clamp(dot(n, lightDir).mul(0.45).add(0.55), 0.0, 1.0);
    const direct: TslNode = uSun.mul(sun.mul(0.58).add(wrap.mul(0.22)));
    const transmission: TslNode = vec3(0.32, 0.42, 0.10).mul(back).mul(uvY.mul(0.34).add(0.12));
    const ambientFloor: TslNode = grassColor.mul(0.22);
    litColor = ambientFloor.add(grassColor.mul(hemi.add(direct))).add(transmission.mul(grassColor));
  } else {
    const direct: TslNode = uSun.mul(pow(sun, 1.25)).mul(0.82);
    const transmission: TslNode = vec3(0.32, 0.42, 0.10).mul(back).mul(uvY.mul(0.34).add(0.12));
    const ambientFloor: TslNode = grassColor.mul(0.22);
    litColor = ambientFloor.add(grassColor.mul(hemi.add(direct))).add(transmission.mul(grassColor));
  }

  let aboveWater: TslNode | null = null;
  if (hydroWaterY) {
    const uWaterClearance = uniform(params.waterClearance ?? 0.5);
    aboveWater = groundY.greaterThan(hydroWaterY.add(uWaterClearance));
  }

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos;
  material.colorNode = litColor;
  if (params.mode === "webgpu-ring-v1") {
    const dist: TslNode = vec2(aOffset.x, aOffset.z).sub(uFadeCenter).length();
    const bandMask: TslNode = grassRingBandMask(aTier, dist, uNearDistance, uMidDistance, uFarDistance, uBandDistance);
    (material as unknown as { maskNode: TslNode }).maskNode =
      aboveWater ? bandMask.and(aboveWater) : bandMask;
  } else if (aboveWater) {
    (material as unknown as { maskNode: TslNode }).maskNode = aboveWater;
  }
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  material.alphaToCoverage = useAlphaToCoverage;

  return {
    material,
    setTime(t: number) { uTime.value = t; },
    setFadeCenter(x: number, z: number) { uFadeCenter.value.set(x, z); },
    updateSettings(settings) {
      uBladeWidth.value = settings.bladeWidth;
      uWindStrength.value = settings.windStrength;
      uWindSpeed.value = settings.windSpeed;
      if ("gustStrength" in settings) uGustStrength.value = (settings as { gustStrength?: number }).gustStrength ?? 0.15;
      const wind = settings.wind;
      if (wind) {
        uWindDir.value.copy(normalizedWindDirection(wind.direction));
        if (wind.turbulence !== undefined) uWindTurbulence.value = wind.turbulence;
        uGustStrength.value = wind.gustStrength;
      }
      const appearanceUpdate = settings.appearance;
      if (appearanceUpdate) {
        uBaseColor.value.set(...appearanceUpdate.baseColor);
        uTipColor.value.set(...appearanceUpdate.tipColor);
        uDryColor.value.set(...appearanceUpdate.dryColor);
        uNormalPull.value = appearanceUpdate.normalPull;
      }
      uNearDistance.value = Math.min(settings.distance * settings.lod.nearFraction, settings.ring.nearMeters);
      uMidDistance.value = Math.min(settings.distance * settings.lod.midFraction, settings.ring.midMeters);
      uFarDistance.value = Math.min(settings.distance * settings.ring.farDistanceFraction, settings.ring.farMeters);
      uBandDistance.value = settings.ring.bandMeters;
      useAlphaToCoverage = isPatchV2 && settings.alphaToCoverage === true;
      material.alphaToCoverage = useAlphaToCoverage;
      material.needsUpdate = true;
    },
    updateLighting(lighting) {
      const light = "sunDirection" in lighting ? lighting.sunDirection : lighting.light;
      uLight.value.copy(light).normalize();
      uSun.value.copy(v3(lighting.sunColor));
      uSky.value.copy(v3(lighting.skyLight));
      uGround.value.copy(v3(lighting.groundLight));
    },
  };
}
