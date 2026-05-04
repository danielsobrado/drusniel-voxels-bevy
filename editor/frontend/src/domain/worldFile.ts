export type WorldPayloadType = "json" | "text";

export interface WorldFileSummaryInput {
  fileName: string;
  text: string;
}

export interface WorldFileSummaryResult {
  entityCount: number;
  name: string;
  payloadType: WorldPayloadType;
  preview: string;
}

export function summarizeWorldFileText({
  fileName,
  text,
}: WorldFileSummaryInput): WorldFileSummaryResult {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const entities = parsed.entities;
    const entityCount = Array.isArray(entities) ? entities.length : 0;
    const name = typeof parsed.name === "string" ? parsed.name : "Untitled world";

    return {
      entityCount,
      preview: "JSON",
      name,
      payloadType: "json",
    };
  } catch {
    return {
      entityCount: 0,
      preview: text.slice(0, 140),
      name: fileName.replace(/\.[^.]+$/, "") || fileName,
      payloadType: "text",
    };
  }
}
