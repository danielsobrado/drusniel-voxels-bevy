import type { GrassShaderMode } from "./grass_config.js";

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aWidthScale;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 lateralWind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    vec2 wind = normalize(uWindDirection + lateralWind * 0.35);
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth * aWidthScale, position.y * aHeight, position.z * uBladeWidth * aWidthScale);
    localPosition.xz += wind;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.35,
      normal.y + bend * 0.16,
      normal.z - wind.y * 0.35
    ));
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    vWorldPos = aOffset + rotatedPosition;
    vUv = uv;
    vColorMix = aColorMix;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 darkGreen = vec3(0.018, 0.055, 0.012);
    vec3 midGreen = vec3(0.075, 0.16, 0.035);
    vec3 tipGreen = vec3(0.18, 0.28, 0.08);
    vec3 dryGrass = vec3(0.28, 0.22, 0.08);
    vec3 grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, vUv.y));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, vUv.y));
    grassColor = mix(grassColor, dryGrass, vColorMix * 0.48);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float back = max(dot(-n, lightDirection), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * pow(sun, 1.25) * 0.82;
    vec3 transmission = vec3(0.32, 0.42, 0.10) * back * (0.12 + vUv.y * 0.34);
    vec3 ambientFloor = grassColor * 0.22;
    gl_FragColor = vec4(ambientFloor + grassColor * (hemi + direct) + transmission * grassColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const TERRAIN_PATCH_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uNearDistance;
  uniform float uMidDistance;
  uniform float uFadeDistance;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aEdgeFade;
  attribute float aNormalY;
  attribute float aWidthScale;
  attribute vec3 aTerrainNormal;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;

  void main() {
    float dist = distance(cameraPosition.xz, aOffset.xz);
    float farFade = 1.0 - smoothstep(uFadeDistance * 0.9, uFadeDistance, dist);
    float nearWeight = 1.0 - smoothstep(uNearDistance * 0.75, uNearDistance, dist);
    float heightFactor = uv.y * uv.y;
    float edge = clamp(aEdgeFade, 0.0, 1.0);
    vec3 terrainNormal = normalize(aTerrainNormal);
    float slope = smoothstep(0.55, 0.96, terrainNormal.y);
    float bendPower = heightFactor * edge * (0.55 + nearWeight * 0.45);

    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.049 + aOffset.z * 0.037;
    vec2 lateralWind = vec2(
      sin(windTime),
      sin(windTime * 0.61 + aOffset.z * 0.021)
    );
    vec2 wind = normalize(uWindDirection + lateralWind * 0.35) * uWindStrength * aHeight * bendPower;

    float edgeHeight = mix(0.35, 1.0, edge);
    float slopeHeight = mix(0.55, 1.0, slope);
    float widthTaper = mix(1.35, 0.85, uv.y);
    vec3 localPosition = vec3(
      position.x * uBladeWidth * widthTaper * aWidthScale,
      position.y * aHeight * edgeHeight * slopeHeight,
      position.z * uBladeWidth * widthTaper * aWidthScale
    );
    localPosition.xz += wind;
    localPosition.y -= length(wind) * 0.08 * heightFactor;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.28,
      normal.y + 0.18 + uv.y * 0.28,
      normal.z - wind.y * 0.24
    ));
    vec3 bladeNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    float terrainNormalPull = smoothstep(0.18, 1.0, uv.y) * 0.35;
    vWorldNormal = normalize(mix(bladeNormal, terrainNormal, terrainNormalPull));
    vUv = uv;
    vColorMix = aColorMix;
    vEdgeFade = edge;
    vDistanceFade = farFade;
    gl_Position = projectionMatrix * viewMatrix * vec4(aOffset + rotatedPosition, 1.0);
  }
`;

const TERRAIN_PATCH_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;
  uniform float uAlphaToCoverage;

  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(a * 0.5) * 0.25 + bayer2(a);
  }

  void main() {
    float coverage = smoothstep(0.0, 0.08, vDistanceFade) * smoothstep(0.08, 0.45, vEdgeFade);
    bool a2c = uAlphaToCoverage > 0.5;
    float cutoff = a2c ? 0.003 : bayer4(gl_FragCoord.xy);
    if (coverage < cutoff) discard;

    vec3 base = vec3(0.018, 0.055, 0.012);
    vec3 mid = vec3(0.075, 0.17, 0.035);
    vec3 tip = vec3(0.20, 0.30, 0.085);
    vec3 dry = vec3(0.30, 0.24, 0.09);
    vec3 color = mix(base, mid, smoothstep(0.0, 0.7, vUv.y));
    color = mix(color, tip, smoothstep(0.62, 1.0, vUv.y));
    color = mix(color, dry, vColorMix * 0.35);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float wrap = clamp(dot(n, lightDirection) * 0.45 + 0.55, 0.0, 1.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * (sun * 0.58 + wrap * 0.22);
    vec3 transmission = vec3(0.32, 0.42, 0.10) * max(dot(-n, lightDirection), 0.0) * (0.12 + vUv.y * 0.34);
    vec3 ambientFloor = color * 0.22;
    gl_FragColor = vec4(ambientFloor + color * (hemi + direct) + transmission * color, a2c ? coverage : 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GrassShaderDefinition {
  vertexShader: string;
  fragmentShader: string;
  patchStyle: "classic" | "terrain-patch";
  usesTerrainPatchPlacement: boolean;
}

const GRASS_SHADER_DEFINITIONS: Record<GrassShaderMode, GrassShaderDefinition> = {
  "terrain-patch-v2": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  "webgpu-ring-v1": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  classic: {
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    patchStyle: "classic",
    usesTerrainPatchPlacement: false,
  },
};

export function grassShaderDefinition(mode: GrassShaderMode): GrassShaderDefinition {
  return GRASS_SHADER_DEFINITIONS[mode];
}
