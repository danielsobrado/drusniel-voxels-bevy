import type { StoreApi } from "zustand";
import type { EditorBackendClient } from "../backend/EditorBackendClient";
import type { RuntimeClient } from "../runtime/RuntimeClient";
import type { EditorStore } from "../state/editorStore";

export type CommandId = string;

export interface EditorCommandContext {
  readonly getState: StoreApi<EditorStore>["getState"];
  readonly setState: StoreApi<EditorStore>["setState"];
  readonly toast: {
    readonly success: (message: string) => void;
    readonly info: (message: string) => void;
    readonly warning: (message: string) => void;
    readonly error: (message: string) => void;
  };
  readonly backendClient: EditorBackendClient;
  readonly runtimeClient: RuntimeClient;
  readonly pushCommandHistory: (commandId: string, title: string) => void;
  readonly pushAgentTimelineEvent: EditorStore["pushAgentTimelineEvent"];
  readonly openCommandPalette: () => void;
  readonly openWorldFile: () => void;
}

export interface EditorCommand {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly shortcut?: string;
  readonly keywords?: readonly string[];
  readonly preconditions?: readonly string[];
  readonly run: (ctx: EditorCommandContext) => Promise<void> | void;
}
