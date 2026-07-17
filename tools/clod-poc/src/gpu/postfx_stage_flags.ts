export type PostFxStage =
  | "aerial"
  | "autoExposure"
  | "bloom"
  | "bounce"
  | "clouds"
  | "colorScript"
  | "contact"
  | "froxels"
  | "godrays"
  | "gtao"
  | "taa";

export interface PostFxStageFlags {
  postMin: boolean;
  enabled: Record<PostFxStage, boolean>;
}

const STAGES: readonly PostFxStage[] = [
  "aerial",
  "autoExposure",
  "bloom",
  "bounce",
  "clouds",
  "colorScript",
  "contact",
  "froxels",
  "godrays",
  "gtao",
  "taa",
] as const;

const STAGE_ALIASES = new Map<string, PostFxStage>([
  ["aerial", "aerial"],
  ["haze", "aerial"],
  ["hillaire", "aerial"],
  ["autoexposure", "autoExposure"],
  ["exposure", "autoExposure"],
  ["bloom", "bloom"],
  ["bounce", "bounce"],
  ["ssbounce", "bounce"],
  ["colorbounce", "bounce"],
  ["cloud", "clouds"],
  ["clouds", "clouds"],
  ["volumetriccloud", "clouds"],
  ["volumetricclouds", "clouds"],
  ["colorscript", "colorScript"],
  ["grade", "colorScript"],
  ["todgrade", "colorScript"],
  ["contact", "contact"],
  ["contactshadow", "contact"],
  ["contactshadows", "contact"],
  ["froxel", "froxels"],
  ["froxels", "froxels"],
  ["volumetrics", "froxels"],
  ["volumetricfog", "froxels"],
  ["godray", "godrays"],
  ["godrays", "godrays"],
  ["shafts", "godrays"],
  ["lightshafts", "godrays"],
  ["gtao", "gtao"],
  ["ao", "gtao"],
  ["ambientocclusion", "gtao"],
  ["taa", "taa"],
  ["traa", "taa"],
]);

function truthyQueryValue(value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function disabledStageSet(value: string | null): Set<PostFxStage> {
  const disabled = new Set<PostFxStage>();
  if (!value) return disabled;
  for (const token of value.split(/[,+\s]+/g)) {
    const key = token.trim().toLowerCase().replace(/[-_]/g, "");
    if (!key || key === "none") continue;
    if (key === "all") {
      for (const stage of STAGES) disabled.add(stage);
      continue;
    }
    const stage = STAGE_ALIASES.get(key);
    if (stage) disabled.add(stage);
  }
  return disabled;
}

export function parsePostFxStageFlags(search: string | URLSearchParams): PostFxStageFlags {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const postMin = truthyQueryValue(params.get("postmin")) || truthyQueryValue(params.get("postMin"));
  const ablated = disabledStageSet(params.get("ablate"));
  const enabled = Object.fromEntries(STAGES.map((stage) => [stage, !ablated.has(stage)])) as Record<PostFxStage, boolean>;

  if (postMin) {
    for (const stage of STAGES) enabled[stage] = false;
    enabled.colorScript = !ablated.has("colorScript");
  }

  return { postMin, enabled };
}

export function stageAllowed(flags: PostFxStageFlags, stage: PostFxStage): boolean {
  return flags.enabled[stage];
}
