import type { CustomPropsSettings, PropAssetDef, PropCategory, PropPivotMode, PropSnapGroup, PropSnapPoint } from "./prop_types.js";
import { PROP_CATEGORIES } from "./prop_config.js";

const CATALOG_URL = "assets/construction/quaternius/rpg_items/models/construction-props.catalog.json";
const SNAP_GROUPS: readonly PropSnapGroup[] = ["prop-bottom", "prop-top", "prop-side", "prop-door", "prop-window", "prop-roof", "prop-foundation"];

interface CatalogEntry {
  id?: unknown;
  source?: unknown;
  category?: unknown;
  scale?: unknown;
  pivot?: unknown;
  snap_points?: unknown;
  snapPoints?: unknown;
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
  return lower.includes("barrel") || lower.includes("crate") || lower.includes("cart") || lower.includes("stall") ? "medium_static" : "small_decor";
}

function pivot(value: unknown): PropPivotMode | undefined {
  const parsed = text(value);
  return parsed === "original" || parsed === "bottom_center" || parsed === "bounds_center" || parsed === "front_bottom_center" ? parsed : undefined;
}

function sourceUrl(catalogUrl: string, source: string): string {
  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("//") || source.startsWith("/")) return source;
  return new URL(source, new URL(catalogUrl, window.location.href)).toString();
}

function vec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : null;
}

function snapGroup(value: unknown): PropSnapGroup | null {
  const parsed = text(value).replaceAll("_", "-") as PropSnapGroup;
  return SNAP_GROUPS.includes(parsed) ? parsed : null;
}

function snapGroups(value: unknown): PropSnapGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map(snapGroup).filter((entry): entry is PropSnapGroup => entry !== null);
}

function snapPoint(value: unknown): PropSnapPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const localPos = vec3(record.local_pos ?? record.localPos);
  const direction = vec3(record.direction);
  const group = snapGroup(record.group);
  if (!id || !localPos || !direction || !group) return null;
  return { id, localPos, direction, group, accepts: snapGroups(record.accepts) };
}

function readSnapPoints(value: unknown): PropSnapPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map(snapPoint).filter((entry): entry is PropSnapPoint => entry !== null);
  return parsed.length > 0 ? parsed : undefined;
}

function toProp(catalogUrl: string, packId: string, entry: CatalogEntry): PropAssetDef | null {
  const source = text(entry.source);
  if (!source || !source.toLowerCase().match(/\.(glb|gltf)$/)) return null;
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
    lod: { mode: "generated", distances: [0, 45, 100, 180, 280], triangleRatios: [1, 0.5, 0.25, 0.1], billboardFrom: 180, hysteresis: 12 },
    culling: { maxDistance: 280, shadowDistance: 72, reflectionDistance: 120, minScreenPx: 5 },
    collision: { mode: "box", distance: 56 },
    lightingProxy: large ? { mode: "coarse_bounds", affectGi: true, affectFog: true } : undefined,
    pivot: pivot(entry.pivot) ?? "bottom_center",
    snapPoints: readSnapPoints(entry.snap_points ?? entry.snapPoints),
  };
}

export async function loadDefaultExternalPropCatalog(settings: CustomPropsSettings): Promise<CustomPropsSettings> {
  const catalogUrl = new URL(CATALOG_URL, window.location.href).toString();
  try {
    const response = await fetch(catalogUrl, { cache: "force-cache" });
    if (!response.ok) {
      console.warn(`[props] Quaternius construction catalog HTTP ${response.status} at ${catalogUrl}`);
      return settings;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const trimmed = body.trimStart();
    if (contentType.includes("text/html") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
      console.warn(`[props] Quaternius construction catalog missing or SPA-fallback HTML at ${catalogUrl}`);
      return settings;
    }
    const catalog = JSON.parse(body) as CatalogFile;
    const packId = safeId("pack", text(catalog.packId), CATALOG_URL);
    const props = Array.isArray(catalog.props) ? catalog.props.map((entry) => toProp(catalogUrl, packId, entry as CatalogEntry)).filter((entry): entry is PropAssetDef => entry !== null) : [];
    if (props.length === 0) {
      console.info(`[props] Quaternius construction catalog loaded with 0 authored prop(s) from ${catalogUrl}`);
      return settings;
    }
    const byId = new Map(settings.props.map((prop) => [prop.id, prop]));
    for (const prop of props) byId.set(prop.id, prop);
    console.info(`[props] loaded ${props.length} Quaternius construction prop(s)`);
    return { ...settings, props: [...byId.values()] };
  } catch (error) {
    console.warn("[props] Quaternius construction catalog unavailable", error);
    return settings;
  }
}
