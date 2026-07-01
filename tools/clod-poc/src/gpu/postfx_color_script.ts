import { load } from "js-yaml";
import type { EnvironmentLighting } from "../environment/environment.js";
import colorScriptYaml from "../environment/config/postfx_color_script.yaml?raw";

export type GradeColor = [number, number, number];

export interface PostFxGradeParams {
  whiteBalance: GradeColor;
  shadowTint: GradeColor;
  shadowAmount: number;
  highlightTint: GradeColor;
  highlightAmount: number;
  saturation: number;
  contrast: number;
}

export interface PostFxColorScriptKeyframe extends PostFxGradeParams {
  sunHeight: number;
}

export interface PostFxColorScript {
  keyframes: PostFxColorScriptKeyframe[];
}

const DEFAULT_GRADE: PostFxGradeParams = {
  whiteBalance: [1.0, 1.0, 1.0],
  shadowTint: [0.92, 0.98, 1.06],
  shadowAmount: 0.28,
  highlightTint: [1.04, 1.01, 0.96],
  highlightAmount: 0.16,
  saturation: 1.0,
  contrast: 1.0,
};

const FALLBACK_SCRIPT: PostFxColorScript = {
  keyframes: [
    { sunHeight: -0.3, ...DEFAULT_GRADE, saturation: 0.8, contrast: 1.06 },
    { sunHeight: 0.1, ...DEFAULT_GRADE, whiteBalance: [1.05, 0.97, 0.95], highlightTint: [1.12, 1.0, 0.88], saturation: 1.1, contrast: 1.05 },
    { sunHeight: 0.95, ...DEFAULT_GRADE, saturation: 1.13, contrast: 1.07 },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function colorValue(value: unknown, fallback: GradeColor): GradeColor {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : fallback;
}

function gradeFromRecord(record: Record<string, unknown>, fallback: PostFxGradeParams): PostFxGradeParams {
  return {
    whiteBalance: colorValue(record.white_balance, fallback.whiteBalance),
    shadowTint: colorValue(record.shadow_tint, fallback.shadowTint),
    shadowAmount: clamp01(finiteNumber(record.shadow_amount, fallback.shadowAmount)),
    highlightTint: colorValue(record.highlight_tint, fallback.highlightTint),
    highlightAmount: clamp01(finiteNumber(record.highlight_amount, fallback.highlightAmount)),
    saturation: Math.max(0, finiteNumber(record.saturation, fallback.saturation)),
    contrast: Math.max(0.01, finiteNumber(record.contrast, fallback.contrast)),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: GradeColor, b: GradeColor, t: number): GradeColor {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerpGrade(a: PostFxGradeParams, b: PostFxGradeParams, t: number): PostFxGradeParams {
  return {
    whiteBalance: lerpColor(a.whiteBalance, b.whiteBalance, t),
    shadowTint: lerpColor(a.shadowTint, b.shadowTint, t),
    shadowAmount: lerp(a.shadowAmount, b.shadowAmount, t),
    highlightTint: lerpColor(a.highlightTint, b.highlightTint, t),
    highlightAmount: lerp(a.highlightAmount, b.highlightAmount, t),
    saturation: lerp(a.saturation, b.saturation, t),
    contrast: lerp(a.contrast, b.contrast, t),
  };
}

function sortedKeyframes(keyframes: PostFxColorScriptKeyframe[]): PostFxColorScriptKeyframe[] {
  return [...keyframes].sort((a, b) => a.sunHeight - b.sunHeight);
}

export function parsePostFxColorScript(yamlText = colorScriptYaml): PostFxColorScript {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_SCRIPT;
    const root = isRecord(raw.postfx_color_script) ? raw.postfx_color_script : raw;
    const rawKeyframes = Array.isArray(root.keyframes) ? root.keyframes : [];
    const keyframes = rawKeyframes
      .filter(isRecord)
      .map((keyframe) => ({
        sunHeight: finiteNumber(keyframe.sun_height, 0.5),
        ...gradeFromRecord(keyframe, DEFAULT_GRADE),
      }));
    return keyframes.length >= 2 ? { keyframes: sortedKeyframes(keyframes) } : FALLBACK_SCRIPT;
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_color_script.yaml; using fallback", error);
    return FALLBACK_SCRIPT;
  }
}

export const DEFAULT_POSTFX_COLOR_SCRIPT: PostFxColorScript = parsePostFxColorScript();
export const DEFAULT_POSTFX_GRADE: PostFxGradeParams = gradeForSunHeight(DEFAULT_POSTFX_COLOR_SCRIPT, 0.8);

export function gradeForSunHeight(script: PostFxColorScript, sunHeight: number): PostFxGradeParams {
  const keyframes = sortedKeyframes(script.keyframes);
  if (keyframes.length === 0) return DEFAULT_GRADE;
  if (sunHeight <= keyframes[0].sunHeight) return keyframes[0];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (!a || !b || sunHeight > b.sunHeight) continue;
    const t = (sunHeight - a.sunHeight) / Math.max(0.0001, b.sunHeight - a.sunHeight);
    return lerpGrade(a, b, clamp01(t));
  }
  return keyframes[keyframes.length - 1] ?? DEFAULT_GRADE;
}

export function gradeForLighting(
  lighting: EnvironmentLighting,
  script: PostFxColorScript = DEFAULT_POSTFX_COLOR_SCRIPT,
): PostFxGradeParams {
  return gradeForSunHeight(script, lighting.sunDirection.y);
}
