function levelColorGlsl(): string {
  return [
    "  vec3 waterLevelColor(float level) {",
    "    int idx = int(clamp(floor(level), 0.0, 5.0));",
    "    if (idx == 0) return vec3(0.36, 0.62, 0.95);",
    "    if (idx == 1) return vec3(0.30, 0.86, 0.58);",
    "    if (idx == 2) return vec3(0.94, 0.74, 0.30);",
    "    if (idx == 3) return vec3(0.95, 0.42, 0.46);",
    "    if (idx == 4) return vec3(0.66, 0.46, 0.94);",
    "    return vec3(0.42, 0.78, 0.92);",
    "  }",
  ].join("\n");
}

export const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform float uAlpha;
  uniform float uRippleCycle;
  uniform float uFresnelPower;
  uniform float uRippleAmp;
  uniform float uRippleSpeed;
  uniform float uRippleScaleA;
  uniform float uRippleScaleB;
  uniform float uRippleStrengthA;
  uniform float uRippleStrengthB;
  uniform float uRippleLoopDistance;
  uniform vec2 uLakeBreeze;
  uniform float uShoreFoamStart;
  uniform float uShoreFoamEnd;
  uniform float uShoreDistFoamStart;
  uniform float uShoreDistFoamEnd;
  uniform float uFoamNoiseScale;
  uniform float uFoamShoreStrength;
  uniform float uFoamRiverStrength;
  uniform float uFoamSpeedStart;
  uniform float uFoamSpeedEnd;
  uniform float uFoamDropStart;
  uniform float uFoamDropEnd;
  uniform float uFresnelBase;
  uniform float uFresnelNormalFlatten;
  uniform float uDepthScale;
  uniform float uTurbidity;
  uniform float uClipmapTint;
  uniform vec4 uInnerRect;
  uniform int uDebugMode;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  uniform vec2 uWorldBounds;
  uniform float uCausticsEnabled;
  uniform float uCausticsGain;
  uniform float uCausticsScale;
  uniform float uCausticsSpeed;
  uniform float uGlitterEnabled;
  uniform float uGlitterTightExponent;
  uniform float uGlitterTightGain;
  uniform float uGlitterBroadExponent;
  uniform float uGlitterBroadGain;
  uniform float uGlitterLowSunGain;
  uniform vec3 uBodyShallow[6];
  uniform vec3 uBodyDeep[6];
  uniform vec3 uBodyAbsorption[6];
  uniform vec2 uBodyExtra[6];
  uniform vec3 uBodyScatterColor[6];
  uniform vec3 uBodyScatterParams[6];
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying float vBodyKind;
  varying vec4 vFlow;
  varying float vShoreDistance;
  varying float vLevel;

  ${levelColorGlsl()}

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  vec2 rippleGrad(vec2 uv, float phase) {
    float tau = 6.28318530718;
    return vec2(
      cos(uv.x + phase * tau) * uRippleStrengthA + cos((uv.x + uv.y) * 0.73 - phase * tau * 0.7) * uRippleStrengthB,
      -sin(uv.y - phase * tau) * uRippleStrengthA + cos((uv.x - uv.y) * 0.61 + phase * tau * 0.9) * uRippleStrengthB
    );
  }

  vec3 skyReflection(vec3 reflectDir, vec3 sunDir) {
    float reflY = reflectDir.y;
    float reflYClamped = max(reflY, 0.0);
    float sunDot = max(dot(reflectDir, sunDir), 0.0);

    vec3 skyZenith = vec3(0.12, 0.32, 0.72);
    vec3 skyHorizon = vec3(0.55, 0.70, 0.90);
    vec3 skyDawn = vec3(0.85, 0.55, 0.35);
    vec3 horizon = mix(skyDawn, skyHorizon, smoothstep(0.0, 0.25, sunDir.y));
    vec3 sky = mix(horizon, skyZenith, smoothstep(0.0, 0.6, reflYClamped));

    vec3 belowHorizon = mix(vec3(0.035, 0.07, 0.16), vec3(0.07, 0.14, 0.28), smoothstep(-0.5, 0.0, reflY));
    vec3 reflectedSky = mix(belowHorizon, sky, smoothstep(-0.25, 0.12, reflY));

    vec3 mie = vec3(1.0, 0.72, 0.42) * pow(sunDot, 8.0) * 0.25
      + vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * 1.2;
    vec3 sunDisc = vec3(1.0, 0.92, 0.75) * (pow(sunDot, 512.0) * 4.5 + pow(sunDot, 128.0) * 1.4);

    return max(reflectedSky + mie + sunDisc, vec3(0.035, 0.07, 0.14));
  }

  void main() {
    vec3 worldPos = vWorldPos;
    bool finiteWorldBounds = uWorldBounds.x > 0.0 && uWorldBounds.y > 0.0;
    if (finiteWorldBounds && (worldPos.x < 0.0 || worldPos.x > uWorldBounds.x ||
        worldPos.z < 0.0 || worldPos.z > uWorldBounds.y)) {
      discard;
    }
    if (worldPos.x > uInnerRect.x && worldPos.x < uInnerRect.z &&
        worldPos.z > uInnerRect.y && worldPos.z < uInnerRect.w) {
      discard;
    }
    if (vBodyMask <= 0.0) discard;

    float depth = worldPos.y - vTerrainY;
    if (depth <= 0.0) discard;

    float bodyK = clamp(vBodyKind, 0.0, 5.0);
    int bodyK0 = int(floor(bodyK));
    int bodyK1 = int(min(floor(bodyK) + 1.0, 5.0));
    float bodyKt = smoothstep(0.35, 0.65, fract(bodyK));
    vec3 bodyShallow = mix(uBodyShallow[bodyK0], uBodyShallow[bodyK1], bodyKt);
    vec3 bodyDeep = mix(uBodyDeep[bodyK0], uBodyDeep[bodyK1], bodyKt);
    vec3 bodyAbsorption = mix(uBodyAbsorption[bodyK0], uBodyAbsorption[bodyK1], bodyKt);
    vec2 bodyExtra = mix(uBodyExtra[bodyK0], uBodyExtra[bodyK1], bodyKt);
    vec3 bodyScatterColor = mix(uBodyScatterColor[bodyK0], uBodyScatterColor[bodyK1], bodyKt);
    vec3 bodyScatterParams = mix(uBodyScatterParams[bodyK0], uBodyScatterParams[bodyK1], bodyKt);
    vec3 depthMixRgb = 1.0 - exp(-depth * bodyAbsorption);
    float depthNorm = (depthMixRgb.r + depthMixRgb.g + depthMixRgb.b) / 3.0;

    float caustic = 0.0;
    if (uCausticsEnabled > 0.5) {
      vec2 causticUV = worldPos.xz * uCausticsScale;
      float t = uTime * uCausticsSpeed;
      float c1 = sin(causticUV.x * 3.7 + t * 1.1 + causticUV.y * 2.3) *
                 cos(causticUV.y * 4.1 - t * 0.9 + causticUV.x * 1.7);
      float c2 = sin(causticUV.x * 5.3 - t * 0.7 + causticUV.y * 3.9) *
                 cos(causticUV.y * 2.9 + t * 1.3 - causticUV.x * 2.1);
      caustic = (c1 * 0.6 + c2 * 0.4) * 0.5 + 0.5;
      caustic = smoothstep(0.3, 0.8, caustic);
      float depthFade = exp(-depth * 0.32);
      float focalFade = smoothstep(0.04, 0.5, depth);
      caustic *= depthFade * focalFade * uCausticsGain;
    }

    vec2 riverDir = normalize(vec2(vFlow.x, vFlow.y) + vec2(0.00001, 0.0));
    vec2 breezeDir = normalize(uLakeBreeze + vec2(0.00001, 0.0));
    float riverWeight = smoothstep(0.001, 0.02, vFlow.z);
    vec2 advectDir = normalize(mix(breezeDir, riverDir, riverWeight));
    float advectSpeed = max(length(uLakeBreeze), vFlow.z) * uRippleSpeed;
    float phaseA = fract(uTime * uRippleCycle);
    float phaseB = fract(uTime * uRippleCycle + 0.5);
    float blend = abs(phaseA - 0.5) * 2.0;
    vec2 advectA = advectDir * (phaseA * uRippleLoopDistance * advectSpeed);
    vec2 advectB = advectDir * (phaseB * uRippleLoopDistance * advectSpeed);
    vec2 gradA = rippleGrad(worldPos.xz * uRippleScaleA + advectA, phaseA);
    vec2 gradB = rippleGrad(worldPos.xz * uRippleScaleB + advectB + vec2(17.31, -9.47), phaseB);
    vec2 grad = mix(gradA, gradB, blend) * uRippleAmp;
    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));

    vec3 viewDir = normalize(uCameraPos - worldPos);
    vec3 sunDir = normalize(uSunDir);
    vec3 fresnelNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    float ndotv = max(dot(viewDir, fresnelNormal), 0.0);
    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - ndotv, uFresnelPower);

    float opticalThickness = depth / max(ndotv, 0.25);
    float scatterAmount = (1.0 - exp(-opticalThickness * max(bodyScatterParams.x, 0.0)))
      * max(bodyScatterParams.y, 0.0);
    float skyAmbient = mix(0.35, 1.0, smoothstep(-0.05, 0.35, sunDir.y)) * max(bodyScatterParams.z, 0.0);
    vec3 suspendedScatter = bodyScatterColor * scatterAmount * skyAmbient;

    vec3 deepBlue = mix(vec3(0.0, 0.025, 0.10), bodyDeep, 0.65);
    vec3 shallowTeal = mix(bodyShallow, vec3(0.0, 0.45, 0.62), 0.35);
    vec3 waterColor = mix(shallowTeal, deepBlue, depthMixRgb);
    waterColor = mix(waterColor, shallowTeal, bodyExtra.x * (1.0 - depthNorm) * 0.50);
    waterColor += caustic * vec3(0.10, 0.18, 0.16) + suspendedScatter;

    vec3 reflectDir = normalize(reflect(-viewDir, normal));
    vec3 envReflection = skyReflection(reflectDir, sunDir) * 0.88;

    float foamA1 = noise2(worldPos.xz * uFoamNoiseScale + advectA * 0.7);
    float foamB1 = noise2((worldPos.xz + vec2(3.71, 1.13)) * uFoamNoiseScale + advectB * 0.7);
    float foamA2 = noise2(worldPos.xz * uFoamNoiseScale * 0.37 + advectA * 0.41 + vec2(5.17, -3.29));
    float foamB2 = noise2((worldPos.xz + vec2(7.43, 2.81)) * uFoamNoiseScale * 0.37 + advectB * 0.41);
    float varNorm = sqrt(blend * blend + (1.0 - blend) * (1.0 - blend));
    float foamBlend = (mix(foamA1, foamB1, blend) - 0.5) / max(varNorm, 0.01) + 0.5;
    float foamDetail = (mix(foamA2, foamB2, blend) - 0.5) / max(varNorm, 0.01) + 0.5;
    float breakup = smoothstep(0.35, 0.82, foamBlend * 0.62 + foamDetail * 0.38);
    float wetFade = smoothstep(0.005, 0.05, depth) * vBodyMask;
    float bankContact = max(
      1.0 - smoothstep(uShoreFoamStart, uShoreFoamEnd, depth),
      1.0 - smoothstep(uShoreDistFoamStart, uShoreDistFoamEnd, vShoreDistance)
    );
    float shore = bankContact * wetFade * breakup * uFoamShoreStrength;
    float riverFast = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, vFlow.z);
    float riverDrop = smoothstep(uFoamDropStart, uFoamDropEnd, vFlow.w);
    float riverFoam = riverFast * riverDrop * uFoamRiverStrength * wetFade * (0.25 + 0.75 * breakup);
    float foam = clamp(shore + riverFoam, 0.0, 1.0);

    float backlit = pow(max(dot(viewDir, -sunDir), 0.0), 4.0) * 0.30;
    float crestScatter = smoothstep(0.45, 0.95, foamBlend) * 0.24;
    vec3 sss = mix(vec3(0.01, 0.04, 0.14), shallowTeal, 0.55) * (backlit + crestScatter) * (1.0 - depthNorm * 0.45);
    float specDot = max(dot(reflect(-sunDir, normal), viewDir), 0.0);
    float lowSun = 1.0 + (1.0 - smoothstep(0.05, 0.35, sunDir.y)) * max(uGlitterLowSunGain, 0.0);
    float glitter = uGlitterEnabled * lowSun * (
      pow(specDot, max(uGlitterTightExponent, 1.0)) * max(uGlitterTightGain, 0.0)
      + pow(specDot, max(uGlitterBroadExponent, 1.0)) * max(uGlitterBroadGain, 0.0)
    );
    vec3 sunSpec = vec3(1.0, 0.92, 0.76) * glitter;
    vec3 litWater = mix(waterColor + sss + sunSpec, envReflection, clamp(fres * 0.72 * bodyExtra.y, 0.0, 0.82));

    vec3 finalColor = mix(litWater, uFoamColor, foam);
    finalColor = mix(finalColor, waterLevelColor(vLevel), uClipmapTint * 0.18);
    float alpha = clamp(uAlpha + fres * 0.18, 0.0, 1.0);

    vec3 outCol;
    if (uDebugMode == 1) outCol = vec3(depthNorm);
    else if (uDebugMode == 2) outCol = vec3(foam);
    else if (uDebugMode == 3) outCol = vec3(fres);
    else if (uDebugMode == 4) outCol = vec3(vBodyMask);
    else if (uDebugMode == 5) outCol = waterLevelColor(vLevel);
    else if (uDebugMode == 6) outCol = vec3(riverDir * 0.5 + 0.5, clamp(vFlow.z / max(uFoamSpeedEnd, 0.001), 0.0, 1.0));
    else if (uDebugMode == 12) outCol = waterColor;
    else if (uDebugMode == 13) outCol = envReflection;
    else if (uDebugMode == 14) outCol = vec3(specDot);
    else if (uDebugMode == 15) outCol = suspendedScatter;
    else outCol = finalColor;
    float outAlpha = uDebugMode == 0 ? alpha : 1.0;

    gl_FragColor = vec4(outCol, outAlpha);
  }
`;
