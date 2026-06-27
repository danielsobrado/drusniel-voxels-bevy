import { load } from "js-yaml";
import type {
  CustomPropsSettings,
  PropAssetDef,
  PropCategory,
  PropExternalCatalogRef,
} from "./prop_types.js";
import { PROP_CATEGORIES } from "./prop_config.js";

interface CatalogEntry {
  id?: unknown;
  label?: unknown;
  source?: unknown;
  category?: unknown;
  scale?: unknown;
}

interface CatalogFile {
  schemaVersion?: unknown;
  packId?: unknown;
  props?: unknown;
}

interface YamlRecord {
  [key: string]: unknown;
}

const DEFAULT_EXTERNAL_LOD = {
  mode: "generated" as const,
  distances: [0, 45, 100, 180, 280],
  triangleRatios: [1.0, 0.5, 0.25, 0.1],
  billboardFrom: 180,
  hysteresis: 12,
};

const DEFAULT_EXTERNAL_CULLING = {
  maxDistance: 280,
  shadowDistance: 72,
  reflectionDistance: 120,
  minScreenPx: 5,
};

const DEFAULT_EXTERNAL_COLLISION = {
  mode: "box" as const,
  distance: 56,
};

function asRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as YamlRecord : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function catalogRefsFromYaml(configText: string): PropExternalCatalogRef[] {
  const root = asRecord(load(configText));
  const entries = root?.external_catalogs ?? root?.externalCatalogs;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const record = asRecord(entry);
      const url = readString(record?.url);
      return url ? { url, enabled: readBool(record?.enabled, true) } : null;
    })
    .filter((entry): entry is PropExternalCatalogRef => entry !== null);
}

function categoryFrom(value: unknown, source: string): PropCategory {
  const explicit = readString(value) as PropCategory;
  if (PROP_CATEGORIES.includes(explicit)) return explicit;
  const lower = source.toLowerCase();
  if (lower.includes("tree") || lower.includes("bush") || lower.includes("plant")) return "vegetation";
  if (lower.includes("door") || lower.includes("gate") || lower.includes("chest")) return "interactive";
  if (lower.includes("house") || lower.includes("tower") || lower.includes("wall") || lower.includes("bridge")) return "large_static";
  if (lower.includes("barrel") || lower.includes("crate") || lower.includes("cart") || lower.includes("stall")) return "medium_static";
  return "medium_static";
}

function safeId(packId: string, id: string, source: string): string {
  const raw = id || source.replace(/\.[^.]+$/, "");
  const normalized = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${packId}-${normalized}`;
}

function sourceUrl(catalogUrl: string, source: string): string {
  if (/^(https?:)?\/\//i.test(source) || source.startsWith("/")) return source;
  return new URL(source, new URL(catalogUrl, window.location.href)).toString();
}

function propFromCatalogEntry(catalogUrl: string, packId: string, entry: CatalogEntry): PropAssetDef | null {
  const source = readString(entry.source);
  if (!source || !/\.(glb|gltf)$/i.test(source)) return null;
  const id = safeId(packId, readString(entry.id), source);
  const category = categoryFrom(entry.category, source);
  const terrainConform = category === "large_static";
  return {
    id,
    source: sourceUrl(catalogUrl, source),
    category,
    placement: {
      alignToTerrain: true,
      terrainConform,
      snapToGrid: category === "large_static",
      flattenRadius: terrainConform ? Math.max(1.5, Number(entry.scale ?? 1) * 1.5) : undefined,
      slopeLimitDegrees: category === "large_static" ? 18 : 35,
    },
    lod: { ...DEFAULT_EXTERNAL_LOD, distances: [...DEFAULT_EXTERNAL_LOD.distances], triangleRatios: [...DEFAULT_EXTERNAL_LOD.triangleRatios] },
    culling: { ...DEFAULT_EXTERNAL_CULLING },
    collision: { ...DEFAULT_EXTERNAL_COLLISION },
    lightingProxy: category === "large_static" ? { mode: "coarse_bounds", affectGi: true, affectFog: true } : undefined,
  };
}

async function fetchCatalog(ref: PropExternalCatalogRef): Promise<{ url: string; props: PropAssetDef[] }> {
  const url = new URL(ref.url, window.location.href).toString();
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const catalog = await response.json() as CatalogFile;
  const packId = safeId("pack", readString(catalog.packId), ref.url);
  const props = Array.isArray(catalog.props)
    ? catalog.props
      .map((entry) => propFromCatalogEntry(url, packId, entry as CatalogEntry))
      .filter((entry): entry is PropAssetDef => entry !== null)
    : [];
  return { url, props };
}

export async function loadExternalPropCatalogs(
  settings: CustomPropsSettings,
  configText: string,
): Promise<CustomPropsSettings> {
  const refs = [...(settings.externalCatalogs ?? []), ...catalogRefsFromYaml(configText)].filter((ref) => ref.enabled);
  if (refs.length === 0) return settings;

  const propsById = new Map(settings.props.map((prop) => [prop.id, prop]));
  for (const ref of refs) {
    try {
      const catalog = await fetchCatalog(ref);
      for (const prop of catalog.props) propsById.set(prop.id, prop);
      console.info(`[props] loaded ${catalog.props.length} external prop(s) from ${catalog.url}`);
    } catch (error) {
      console.warn(`[props] failed to load external catalog ${ref.url}`, error);
    }
  }

  return {
    ...settings,
    props: [...propsById.values()],
  };
}
