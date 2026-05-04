import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { getAgentObservation, getRuntimeWarnings } from "../../state/editorSelectors";

export function AgentWorkbenchPanel() {
  const editorState = useEditorStore();
  const commandHistory = editorState.commandHistory;
  const timeline = editorState.agentTimeline;
  const observation = getAgentObservation(editorState);
  const warnings = getRuntimeWarnings(editorState);
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const suggestedCommands = [
    "editor.agent.observeScreen",
    "editor.agent.runPlan",
    "editor.agent.generatePlaywrightTest",
    "editor.tests.runViewportSmokeTest",
    "editor.water.openReflectionDebug",
    "editor.water.toggleReflectionMask",
    "editor.water.setDebugBlendFactor",
    "editor.water.runVisualProbe",
    "editor.water.focusNearestWaterBody",
    "editor.water.applyRiverPreset",
  ];

  return (
    <section className="panel-shell" data-testid="panel-agent-workbench" aria-labelledby="agent-workbench-title">
      <PanelTitleBar title="Agent Workbench" />
      <div className="panel-body">
        <h2 id="agent-workbench-title" className="placeholder-heading">Agent Workbench</h2>
        <p className="agent-hint">Agent Hint: automation is deferred; this panel exposes readable shell state for LLM operators.</p>
        <div className="agent-card">
          <strong>Observation</strong>
          <span>{observation.summary}</span>
        </div>
        <div className="agent-card">
          <strong>Selected object</strong>
          <span>{observation.selectedObjectLabel}</span>
        </div>
        <div className="agent-card">
          <strong>Runtime warnings</strong>
          <span>{warnings.length ? warnings.join(" ") : "No mocked warnings."}</span>
        </div>
        <div className="agent-card">
          <strong>Recent command route</strong>
          <span>{commandHistory[0]?.label ?? "No commands run yet."}</span>
        </div>
        <div className="agent-card">
          <strong>Timeline</strong>
          <span>{timeline[0]?.message ?? "No agent timeline events."}</span>
        </div>
        <div className="agent-card">
          <strong>Suggested commands</strong>
          <div className="agent-command-list">
            {suggestedCommands.map((commandId) => (
              <button key={commandId} type="button" className="toolbar-button" aria-label={`Run ${commandId}`} data-command-id={commandId} onClick={() => void runCommandById(commandId)}>
                {commandId}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
