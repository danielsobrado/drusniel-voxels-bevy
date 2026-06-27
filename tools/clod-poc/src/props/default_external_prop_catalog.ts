import type { CustomPropsSettings, PropAssetDef, PropCategory } from "./prop_types.js";
import { PROP_CATEGORIES } from "./prop_config.js";

const CATALOG_URL = "assets/construction/quaternius/rpg_items/models/construction-props.catalog.json";

interface CatalogEntry {
  id?: unknown;
  source?: unknown;
  category?: unknown;
  scale?: unknown;
}

interface CatalogFile {
  packId?: unknown;
  props?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(packId: string, id: string, source: string): string {
  const raw = id || source.replace(/\.[^.]+$/, "");
  return `${packId}-${raw}`
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function category(value: unknown, source: string): PropCategory {
  const explicit = text(value) as PropCategory;
  if (PROP_CATEGORIES.includes(explicit)) return explicit;
  const lower = source.toLowerCase();
  if (lower.includes("tree") || lower.includes("bush") || lower.includes("plant")) return "vegetation";
  if (lower.includes("door") || lower.includes("gate") || lower.includes("chest")) return "interactive";
  if (lower.includes("house") || lower.includes("tower") || lower.includes("wall") || lower.includes("bridge")) return "large_static";
  return lower.includes("barrel") || lower.includes("crate") || lower.includes("cart") || lower.includes("stall")
    ? "medium_static"
    : "small_decor";
}

function sourceUrl(catalogUrl: string, source: string): string {
  if (/^(https?:)?\/\//i.test(source) || source.startsWith("/")) return source;
  return new URL(source, new URL(catalogUrl, window.location.href)).toString();
}

function toProp(catalogUrl: string, packId: string, entry: CatalogEntry): PropAssetDef | null {
  const source = text(entry.source);
  if (!source || !/\.(glb|gltf)$/i.test(source)) return null;
  const propCategory = category(entry.category, source);
  const large = propCategory === "large_static";
  return {
    id: safeId(packId, text(entry.id), source),
    source: sourceUrl(catalogUrl, source),
    category: propCategory,
    placement: {
      alignToTerrain: true,
      terrainConform: large,
      snapToGrid: large,
      flattenRadius: large ? Math.max(1.5, Number(entry.scale ?? 1) * 1.5) : undefined,
      slopeLimitDegrees: large ? 18 : 35,
    },
    lod: {
      mode: "generated",
      distances: [0, 45, 100, 180, 280],
      triangleRatios: [1, 0.5, 0.25, 0.1],
      billboardFrom: 180,
      hysteresis: 12,
    },
    culling: {
      maxDistance: 280,
      shadowDistance: 72,
      reflectionDistance: 120,
      minScreenPx: 5,
    },
    collision: {
      mode: "box",
      distance: 56,
    },
    lightingProxy: large ? { mode: "coarse_bounds", affectGi: true, affectFog: true } : undefined,
  };
}

export async function loadDefaultExternalPropCatalog(settings: CustomPropsSettings): Promise<CustomPropsSettings> {
  const catalogUrl = new URL(CATALOG_URL, window.location.href).toString();
  try {
    const response = await fetch(catalogUrl, { cache: "force-cache" });
    if (!response.ok) return settings;
    const catalog = await response.json() as CatalogFile;
    const packId = safeId("pack", text(catalog.packId), CATALOG_URL);
    const props = Array.isArray(catalog.props)
      ? catalog.props
        .map((entry) => toProp(catalogUrl, packId, entry as CatalogEntry))
        .filter((entry): entry is PropAssetDef => entry !== null)
      : [];
    if (props.length === 0) return settings;
    const byId = new Map(settings.props.map((prop) => [prop.id, prop]));
    for (const prop of props) byId.set(prop.id, prop);
    console.info(`[props] loaded ${props.length} Quaternius construction prop(s)`);
    return { ...settings, props: [...byId.values()] };
  } catch (error) {
    console.warn("[props] Quaternius construction catalog unavailable", error);
    return settings;
  }
}
