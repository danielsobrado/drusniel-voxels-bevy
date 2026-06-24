// Bundle the texture files with the app so they are served same-origin. Fetching them
// cross-origin from raw.githubusercontent.com fails: that host sends no
// Access-Control-Allow-Origin header, so a crossOrigin="anonymous" TextureLoader request
// is rejected and the built-in texture load throws, aborting the rest of init.
const BUNDLED_TEXTURE_URLS = import.meta.glob<string>("../../textures/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});

export const demoTextureUrl = (file: string): string => {
  const entry = Object.entries(BUNDLED_TEXTURE_URLS).find(([path]) => path.endsWith(`/${file}`));
  if (!entry) throw new Error(`Bundled texture not found: ${file}`);
  return entry[1];
};

export const DEFAULT_TERRAIN_TEXTURE_PRESETS = [
  { id: "grass-2", scale: 0.06, heightMin: 12, heightMax: 18 },
  { id: "earth-2", scale: 0.04, heightMin: 18, heightMax: 40 },
  { id: "earth-1", scale: 0.04, heightMin: 40, heightMax: 60 },
  { id: "snow-rocks-1", scale: 0.025, heightMin: 60, heightMax: 118 },
] as const;

export const BUILTIN_TERRAIN_TEXTURES = [
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
] as const;
