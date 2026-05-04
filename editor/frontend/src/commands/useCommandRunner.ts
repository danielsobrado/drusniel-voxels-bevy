import { useCallback } from "react";
import { toast } from "sonner";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";
import { editorCommands, runCommand } from "./commandRegistry";
import type { EditorCommandContext } from "./commandTypes";
import { useEditorStore } from "../state/editorStore";

const backendClient = new MockEditorBackendClient();
const runtimeClient = new MockRuntimeClient();

interface UseCommandRunnerOptions {
  readonly openCommandPalette?: () => void;
  readonly openWorldFile?: () => void;
}

export function useCommandRunner(options: UseCommandRunnerOptions = {}) {
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
        backendClient,
        runtimeClient,
        pushCommandHistory: (id, title) => useEditorStore.getState().pushCommandHistory(id, title),
        pushAgentTimelineEvent: (event) => useEditorStore.getState().pushAgentTimelineEvent(event),
        openCommandPalette: options.openCommandPalette ?? (() => undefined),
        openWorldFile: options.openWorldFile ?? (() => undefined),
      };

      await runCommand(commandId, context);
    },
    [options.openCommandPalette, options.openWorldFile],
  );

  return {
    commands: editorCommands,
    runCommandById,
  };
}
