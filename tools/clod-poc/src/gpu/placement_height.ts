import * as THREE from "three";
import { clamp, float, floor, mix, texture, vec2 } from "three/tsl";
import { sampleGridBilinearByRes } from "../water/hydrologyGrid.js";
import { surfaceHeightCore } from "./terrain_field_core.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export function sampleCarvedBedBilinear(
  carvedBed: Float32Array,
  res: number,
  worldCells: number,
  x: number,
  z: number,
): number {
  return sampleGridBilinearByRes(carvedBed, res, worldCells, x, z);
}

export function placementGroundHeightCpu(
  x: number,
  z: number,
  hydroEnabled: boolean,
  carvedBed: Float32Array | null,
  res: number,
  worldCells: number,
): number {
  if (hydroEnabled && carvedBed && res > 1) {
    return sampleCarvedBedBilinear(carvedBed, res, worldCells, x, z);
  }
  return surfaceHeightCore(x, z);
}

export interface HydrologyMaterialSampling {
  texture: THREE.Texture;
  worldSize: number;
  res: number;
}

function hydroTexelUv(ix: TslNode, iz: TslNode, res: TslNode): TslNode {
  const denom = res.sub(1).max(float(1));
  return vec2(ix, iz).div(denom);
}

export function sampleHydrologyBilinearTsl(
  wx: TslNode,
  wz: TslNode,
  hydro: HydrologyMaterialSampling,
): TslNode {
  const uRes = float(hydro.res);
  const uWorldSize = float(Math.max(1, hydro.worldSize));
  const scale = uRes.sub(1).div(uWorldSize);
  const gx = wx.mul(scale);
  const gz = wz.mul(scale);
  const x0 = floor(gx);
  const z0 = floor(gz);
  const x1 = x0.add(1).min(uRes.sub(1));
  const z1 = z0.add(1).min(uRes.sub(1));
  const fx = clamp(gx.sub(x0), 0, 1);
  const fz = clamp(gz.sub(z0), 0, 1);
  const sampleTexel = (ix: TslNode, iz: TslNode) =>
    texture(hydro.texture, hydroTexelUv(ix, iz, uRes));
  const a = sampleTexel(x0, z0);
  const b = sampleTexel(x1, z0);
  const c = sampleTexel(x0, z1);
  const d = sampleTexel(x1, z1);
  const ab = mix(a, b, fx);
  const cd = mix(c, d, fx);
  return mix(ab, cd, fz);
}

export function sampleCarvedBedBilinearTsl(
  wx: TslNode,
  wz: TslNode,
  hydro: HydrologyMaterialSampling,
): TslNode {
  return sampleHydrologyBilinearTsl(wx, wz, hydro).z;
}
