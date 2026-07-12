import grass008AoUrl from "../../../textures/pbr/jpg/Grass008/Grass008_1K-JPG_AmbientOcclusion.jpg?url";
import grass008ColorUrl from "../../../textures/pbr/jpg/Grass008/Grass008_1K-JPG_Color.jpg?url";
import grass008NormalUrl from "../../../textures/pbr/jpg/Grass008/Grass008_1K-JPG_NormalGL.jpg?url";
import grass008RoughnessUrl from "../../../textures/pbr/jpg/Grass008/Grass008_1K-JPG_Roughness.jpg?url";
import ground048AoUrl from "../../../textures/pbr/jpg/Ground048/Ground048_1K-JPG_AmbientOcclusion.jpg?url";
import ground048ColorUrl from "../../../textures/pbr/jpg/Ground048/Ground048_1K-JPG_Color.jpg?url";
import ground048NormalUrl from "../../../textures/pbr/jpg/Ground048/Ground048_1K-JPG_NormalGL.jpg?url";
import ground048RoughnessUrl from "../../../textures/pbr/jpg/Ground048/Ground048_1K-JPG_Roughness.jpg?url";
import ground054AoUrl from "../../../textures/pbr/jpg/Ground054/Ground054_1K-JPG_AmbientOcclusion.jpg?url";
import ground054ColorUrl from "../../../textures/pbr/jpg/Ground054/Ground054_1K-JPG_Color.jpg?url";
import ground054NormalUrl from "../../../textures/pbr/jpg/Ground054/Ground054_1K-JPG_NormalGL.jpg?url";
import ground054RoughnessUrl from "../../../textures/pbr/jpg/Ground054/Ground054_1K-JPG_Roughness.jpg?url";
import ground067AoUrl from "../../../textures/pbr/jpg/Ground067/Ground067_1K-JPG_AmbientOcclusion.jpg?url";
import ground067ColorUrl from "../../../textures/pbr/jpg/Ground067/Ground067_1K-JPG_Color.jpg?url";
import ground067NormalUrl from "../../../textures/pbr/jpg/Ground067/Ground067_1K-JPG_NormalGL.jpg?url";
import ground067RoughnessUrl from "../../../textures/pbr/jpg/Ground067/Ground067_1K-JPG_Roughness.jpg?url";
import snow007AoUrl from "../../../textures/pbr/jpg/Snow007C/Snow007C_1K-JPG_AmbientOcclusion.jpg?url";
import snow007ColorUrl from "../../../textures/pbr/jpg/Snow007C/Snow007C_1K-JPG_Color.jpg?url";
import snow007NormalUrl from "../../../textures/pbr/jpg/Snow007C/Snow007C_1K-JPG_NormalGL.jpg?url";
import snow007RoughnessUrl from "../../../textures/pbr/jpg/Snow007C/Snow007C_1K-JPG_Roughness.jpg?url";
import snow015AoUrl from "../../../textures/pbr/jpg/Snow015/Snow015_1K-JPG_AmbientOcclusion.jpg?url";
import snow015ColorUrl from "../../../textures/pbr/jpg/Snow015/Snow015_1K-JPG_Color.jpg?url";
import snow015NormalUrl from "../../../textures/pbr/jpg/Snow015/Snow015_1K-JPG_NormalGL.jpg?url";
import snow015RoughnessUrl from "../../../textures/pbr/jpg/Snow015/Snow015_1K-JPG_Roughness.jpg?url";

// Bundle the texture files with the app so they are served same-origin. Fetching them
// cross-origin from raw.githubusercontent.com fails: that host sends no
// Access-Control-Allow-Origin header, so a crossOrigin="anonymous" TextureLoader request
// is rejected and the built-in texture load throws, aborting the rest of init.
const BUNDLED_TEXTURE_URLS = import.meta.glob<string>("../../../textures/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface BuiltinTerrainTexture {
  id: string;
  label: string;
  url: string;
  normalUrl?: string;
  roughnessUrl?: string;
  aoUrl?: string;
}

export const demoTextureUrl = (file: string): string => {
  const entry = Object.entries(BUNDLED_TEXTURE_URLS).find(([path]) => path.endsWith(`/${file}`));
  if (!entry) throw new Error(`Bundled texture not found: ${file}`);
  return entry[1];
};

// Default to the demo textures (detailed albedo). The PBR built-ins have near-uniform albedo that
// reads as flat terrain here, so they stay available in the palette but are not the default.
export const DEFAULT_TERRAIN_TEXTURE_PRESETS = [
  // scale = uv per world metre; 1/scale = tile size. ~0.06 gave a ~16m tile that reads flat up
  // close, so these are tightened to ~4-5m tiles for visible detail at ground level.
  { id: "grass-2", scale: 0.24, heightMin: 0, heightMax: 18 },
  { id: "earth-2", scale: 0.16, heightMin: 14, heightMax: 40 },
  { id: "earth-1", scale: 0.16, heightMin: 36, heightMax: 60 },
  { id: "snow-rocks-1", scale: 0.1, heightMin: 56, heightMax: 118 },
] as const;

export const BUILTIN_TERRAIN_TEXTURES: readonly BuiltinTerrainTexture[] = [
  { id: "pbr-grass-008", label: "PBR Grass 008", url: grass008ColorUrl, normalUrl: grass008NormalUrl, roughnessUrl: grass008RoughnessUrl, aoUrl: grass008AoUrl },
  { id: "pbr-ground-054", label: "PBR Dirt Ground 054", url: ground054ColorUrl, normalUrl: ground054NormalUrl, roughnessUrl: ground054RoughnessUrl, aoUrl: ground054AoUrl },
  { id: "pbr-ground-048", label: "PBR Rocky Ground 048", url: ground048ColorUrl, normalUrl: ground048NormalUrl, roughnessUrl: ground048RoughnessUrl, aoUrl: ground048AoUrl },
  { id: "pbr-ground-067", label: "PBR Dry Ground 067", url: ground067ColorUrl, normalUrl: ground067NormalUrl, roughnessUrl: ground067RoughnessUrl, aoUrl: ground067AoUrl },
  { id: "pbr-snow-007c", label: "PBR Snow 007C", url: snow007ColorUrl, normalUrl: snow007NormalUrl, roughnessUrl: snow007RoughnessUrl, aoUrl: snow007AoUrl },
  { id: "pbr-snow-015", label: "PBR Snow 015", url: snow015ColorUrl, normalUrl: snow015NormalUrl, roughnessUrl: snow015RoughnessUrl, aoUrl: snow015AoUrl },
  { id: "earth-1", label: "Earth 1", url: demoTextureUrl("earth-1.jpg") },
  { id: "earth-2", label: "Earth 2", url: demoTextureUrl("earth-2.jpg") },
  { id: "grass-1", label: "Grass 1", url: demoTextureUrl("grass-1.jpg") },
  { id: "grass-2", label: "Grass 2", url: demoTextureUrl("grass-2.jpg") },
  { id: "cobblestone-1", label: "Cobblestone 1", url: demoTextureUrl("cobblestone-1.jpg") },
  { id: "cobblestone-2", label: "Cobblestone 2", url: demoTextureUrl("cobblestone-2.jpg") },
  { id: "bedrock-1", label: "Bedrock 1", url: demoTextureUrl("bedrock-1.jpg") },
  { id: "bedrock-2", label: "Bedrock 2", url: demoTextureUrl("bedrock-2.jpg") },
  { id: "sand-1", label: "Sand 1", url: demoTextureUrl("sand-1.jpg") },
  { id: "sand-2", label: "Sand 2", url: demoTextureUrl("sand-2.jpg") },
  { id: "terracotta-1", label: "Terracotta 1", url: demoTextureUrl("terracotta-1.jpg") },
  { id: "terracotta-2", label: "Terracotta 2", url: demoTextureUrl("terracotta-2.jpg") },
  { id: "water-1", label: "Water 1", url: demoTextureUrl("water-1.jpg") },
  { id: "water-2", label: "Water 2", url: demoTextureUrl("water-2.jpg") },
  { id: "oak-bark-1", label: "Oak bark 1", url: demoTextureUrl("oak-bark-1.jpg") },
  { id: "oak-bark-2", label: "Oak bark 2", url: demoTextureUrl("oak-bark-2.jpg") },
  { id: "oak-leaf-1", label: "Oak leaf 1", url: demoTextureUrl("oak-leaf-1.jpg") },
  { id: "oak-leaf-2", label: "Oak leaf 2", url: demoTextureUrl("oak-leaf-2.jpg") },
  { id: "snow-1", label: "Snow 1", url: demoTextureUrl("snow-1.jpg") },
  { id: "snow-rocks-1", label: "Snow rocks 1", url: demoTextureUrl("snow-rocks-1.jpg") },
];
