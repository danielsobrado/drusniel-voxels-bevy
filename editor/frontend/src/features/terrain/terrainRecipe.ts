import type { TerrainGenerationConfig, TerrainRecipe } from "../../types/world";

export const cloneTerrainConfig = (config: TerrainGenerationConfig): TerrainGenerationConfig =>
  JSON.parse(JSON.stringify(config)) as TerrainGenerationConfig;

const textToBase64Url = (text: string): string => {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  return Buffer.from(text, "utf8").toString("base64url");
};

const base64UrlToText = (value: string): string => {
  if (typeof atob === "function") {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }

  return Buffer.from(value, "base64url").toString("utf8");
};

export const encodeTerrainRecipe = (recipe: TerrainRecipe): string =>
  `tr-v1:${textToBase64Url(JSON.stringify(recipe))}`;

export const decodeTerrainRecipe = (value: string): TerrainRecipe | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("tr-v1:")) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlToText(trimmed.slice("tr-v1:".length))) as TerrainRecipe;
    return validateTerrainRecipe(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const validateTerrainRecipe = (recipe: TerrainRecipe): boolean =>
  recipe?.version === 1 &&
  Number.isInteger(recipe.seed) &&
  Number.isFinite(recipe.config?.height?.min) &&
  Number.isFinite(recipe.config?.height?.max) &&
  recipe.config.height.min < recipe.config.height.max &&
  Number.isFinite(recipe.config?.continent?.amplitude) &&
  Number.isFinite(recipe.config?.mountains?.amplitude) &&
  Number.isFinite(recipe.config?.hills?.amplitude) &&
  Number.isFinite(recipe.config?.detail?.amplitude);

export const randomTerrainSeed = (): number => Math.floor(Math.random() * 2_000_000_000);
