import { useCallback } from "react";
import { toast } from "sonner";
import { editorCommands, runCommand } from "./commandRegistry";
import type { EditorCommandContext } from "./commandTypes";
import type { EditorBackendClient } from "../backend/EditorBackendClient";
import type { RuntimeClient } from "../runtime/RuntimeClient";
import { useEditorStore } from "../state/editorStore";

interface UseCommandRunnerOptions {
  readonly backendClient: EditorBackendClient;
  readonly runtimeClient: RuntimeClient;
  readonly openCommandPalette?: () => void;
  readonly openWorldFile?: () => void;
}

export function useCommandRunner(options: UseCommandRunnerOptions) {
  const runCommandById = useCallback(
    async (commandId: string) => {
      const context: EditorCommandContext = {
        getState: useEditorStore.getState,
        setState: useEditorStore.setState,
        toast: {
          success: toast.success,
          info: toast.info,
          warning: toast.warning,
          error: toast.error,
        },
        backendClient: options.backendClient,
        runtimeClient: options.runtimeClient,
        pushCommandHistory: (id, title) => useEditorStore.getState().pushCommandHistory(id, title),
        pushAgentTimelineEvent: (event) => useEditorStore.getState().pushAgentTimelineEvent(event),
        openCommandPalette: options.openCommandPalette ?? (() => undefined),
        openWorldFile: options.openWorldFile ?? (() => undefined),
      };

      await runCommand(commandId, context);
    },
    [options.backendClient, options.openCommandPalette, options.openWorldFile, options.runtimeClient],
  );

  return {
    commands: editorCommands,
    runCommandById,
  };
}
