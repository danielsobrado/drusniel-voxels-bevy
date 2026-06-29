import {
  BIOME_PROCEDURAL_MATERIAL_IDS,
  type BiomeProceduralMaterialId,
} from "./materialRecipes.js";

type Rgb = readonly [number, number, number];

export interface AuthoredBiomeMaterialSample {
  albedo: Rgb;
  normal: readonly [number, number, number];
  roughness: number;
}

interface AuthoredBiomeMaterial {
  palette: readonly [Rgb, Rgb, Rgb, Rgb];
  motif: readonly string[];
  normalStrength: number;
  roughness: number;
}

const MOTIF_SIZE = 8;
const MOTIFS = {
  meadow: [
    "01210123",
    "12011230",
    "20123011",
    "11230120",
    "23011201",
    "10122301",
    "32101120",
    "01213021",
  ],
  forest: [
    "32103210",
    "21033211",
    "10322103",
    "33211032",
    "21032110",
    "03211320",
    "32100123",
    "10323210",
  ],
  muck: [
    "00131200",
    "01333120",
    "13321310",
    "03222130",
    "12333100",
    "00213321",
    "03122210",
    "10031320",
  ],
  scree: [
    "30123012",
    "13021302",
    "21302130",
    "03213021",
    "32103210",
    "10230123",
    "23012301",
    "01321230",
  ],
  plains: [
    "01201230",
    "12030120",
    "20123012",
    "01201203",
    "23012012",
    "30120120",
    "12012301",
    "01230120",
  ],
  coast: [
    "01232310",
    "12321001",
    "23210012",
    "32100123",
    "21001232",
    "10012321",
    "00123210",
    "12321001",
  ],
  ocean: [
    "00112210",
    "01123321",
    "11233210",
    "12332100",
    "23321001",
    "33210012",
    "22100123",
    "11001232",
  ],
} as const;

const AUTHORED_BIOME_MATERIALS: Record<BiomeProceduralMaterialId, AuthoredBiomeMaterial> = {
  "meadows-ground": {
    palette: [[0.29, 0.43, 0.17], [0.38, 0.55, 0.23], [0.19, 0.30, 0.12], [0.50, 0.45, 0.20]],
    motif: MOTIFS.meadow,
    normalStrength: 0.18,
    roughness: 0.88,
  },
  "forest-floor": {
    palette: [[0.10, 0.19, 0.08], [0.16, 0.27, 0.10], [0.24, 0.17, 0.09], [0.06, 0.12, 0.06]],
    motif: MOTIFS.forest,
    normalStrength: 0.16,
    roughness: 0.95,
  },
  "swamp-muck": {
    palette: [[0.08, 0.10, 0.07], [0.13, 0.16, 0.09], [0.18, 0.13, 0.08], [0.05, 0.07, 0.06]],
    motif: MOTIFS.muck,
    normalStrength: 0.10,
    roughness: 0.44,
  },
  "mountain-scree": {
    palette: [[0.35, 0.35, 0.33], [0.49, 0.47, 0.43], [0.24, 0.25, 0.24], [0.42, 0.36, 0.30]],
    motif: MOTIFS.scree,
    normalStrength: 0.38,
    roughness: 0.84,
  },
  "plains-grass": {
    palette: [[0.44, 0.39, 0.15], [0.55, 0.49, 0.20], [0.25, 0.30, 0.11], [0.63, 0.55, 0.28]],
    motif: MOTIFS.plains,
    normalStrength: 0.14,
    roughness: 0.91,
  },
  "coast-sand": {
    palette: [[0.67, 0.59, 0.39], [0.78, 0.70, 0.48], [0.50, 0.43, 0.30], [0.88, 0.82, 0.62]],
    motif: MOTIFS.coast,
    normalStrength: 0.07,
    roughness: 0.97,
  },
  "ocean-floor": {
    palette: [[0.24, 0.22, 0.17], [0.31, 0.29, 0.22], [0.14, 0.17, 0.14], [0.39, 0.35, 0.25]],
    motif: MOTIFS.ocean,
    normalStrength: 0.08,
    roughness: 0.66,
  },
};

export function isAuthoredBiomeMaterialId(value: string): value is BiomeProceduralMaterialId {
  return (BIOME_PROCEDURAL_MATERIAL_IDS as readonly string[]).includes(value);
}

export function sampleAuthoredBiomeMaterial(
  id: BiomeProceduralMaterialId,
  u: number,
  v: number,
): AuthoredBiomeMaterialSample {
  const material = AUTHORED_BIOME_MATERIALS[id];
  const x = wrappedTileCoord(u);
  const y = wrappedTileCoord(v);
  const value = motifValue(material.motif, x, y);
  const right = motifValue(material.motif, x + 1, y);
  const up = motifValue(material.motif, x, y + 1);
  const albedo = material.palette[value];
  const dx = (right - value) / 3;
  const dy = (up - value) / 3;
  return {
    albedo,
    normal: [
      0.5 - dx * material.normalStrength,
      0.5 - dy * material.normalStrength,
      1,
    ],
    roughness: material.roughness,
  };
}

function wrappedTileCoord(value: number): number {
  return ((Math.floor(value * MOTIF_SIZE) % MOTIF_SIZE) + MOTIF_SIZE) % MOTIF_SIZE;
}

function motifValue(motif: readonly string[], x: number, y: number): number {
  const yy = ((y % MOTIF_SIZE) + MOTIF_SIZE) % MOTIF_SIZE;
  const xx = ((x % MOTIF_SIZE) + MOTIF_SIZE) % MOTIF_SIZE;
  return Number(motif[yy][xx]) || 0;
}
