export const WATER_VERT = /* glsl */ `
  attribute float aTerrainY;
  attribute float aBodyMask;
  attribute float aBodyKind;
  attribute vec4 aFlow;
  attribute float aShoreDistance;
  attribute float aLevel;
  varying vec3 vWorldPos;
  varying float vTerrainY;
  varying float vBodyMask;
  varying float vBodyKind;
  varying vec4 vFlow;
  varying float vShoreDistance;
  varying float vLevel;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vTerrainY = aTerrainY;
    vBodyMask = aBodyMask;
    vBodyKind = aBodyKind;
    vFlow = aFlow;
    vShoreDistance = aShoreDistance;
    vLevel = aLevel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
