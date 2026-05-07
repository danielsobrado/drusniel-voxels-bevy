import { useMemo } from "react";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { getAgentObservation } from "../../state/editorSelectors";

const agentCommandIds = [
  "editor.agent.observeScreen",
  "editor.agent.runPlan",
  "editor.agent.approveStep",
  "editor.agent.rejectStep",
  "editor.agent.revisePlan",
  "editor.agent.generatePlaywrightTest",
  "editor.agent.compareBeforeAfter",
  "editor.agent.saveSnapshot",
  "editor.agent.copyObservationJson",
  "editor.history.undo",
  "editor.history.redo",
  "editor.snapshot.create",
  "editor.snapshot.restoreLatest",
  "editor.help.showHandoff",
];

const TEST_RESULTS_HEADER = "Mocked Playwright tests";

export function AgentWorkbenchPanel() {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const timeline = editorState.agentTimeline;
  const observation = getAgentObservation(editorState);
  const selected = observation.selected;
  const suggestionList = useMemo(() => observation.suggestedCommands.join(", "), [observation.suggestedCommands]);
  const latestSnapshot = editorState.savedSnapshots[0];

  const generatedTests = timeline
    .filter((entry) => entry.message.toLowerCase().includes("playwright test"))
    .map((entry) => entry.message)
    .slice(0, 6);

  const timelineRows = timeline.slice(0, 6).map((entry) => `${entry.kind.toUpperCase()}: ${entry.message}`);

  const runAgentCommand = async (commandId: string) => {
    await runCommandById(commandId);
  };

  return (
    <section className="panel-shell" data-testid="panel-agent-workbench" aria-labelledby="agent-workbench-title">
      <PanelTitleBar title="Agent Workbench" />
      <div className="panel-body">
        <h2 id="agent-workbench-title" className="placeholder-heading">
          Agent Workbench
        </h2>
        <p className="agent-hint" aria-label="agent-hint">
          Agent Hint: each section is screen-readability friendly and command-driven.
        </p>

        <article className="agent-card" data-testid="agent-section-screen-understanding">
          <h3>Screen Understanding</h3>
          <p>{`Mode: ${observation.activeMode}. Tool: ${observation.activeTool}.`}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-current-selection">
          <h3>Current Selection</h3>
          <p data-testid="agent-selection-summary">{selected ? `${selected.kind}: ${selected.label}` : "No selection"}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-active-mode">
          <h3>Active Mode</h3>
          <p>{observation.activeMode}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-active-tool">
          <h3>Active Tool</h3>
          <p>{observation.activeTool}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-visible-panels">
          <h3>Visible Panels</h3>
          <ul aria-label="Visible panels">
            {observation.visiblePanels.map((panel) => (
              <li key={panel}>{panel}</li>
            ))}
          </ul>
        </article>

        <article className="agent-card" data-testid="agent-section-viewport">
          <h3>Viewport Readout</h3>
          <p>Camera: {observation.viewport.cameraPosition.join(", ")}</p>
          <p>Target voxel: {observation.viewport.targetVoxel?.join(", ") ?? "unknown"}</p>
          <p>Overlays: {observation.viewport.overlays.join(", ") || "none"}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-brush-state">
          <h3>Brush State</h3>
          <p>{`Radius ${observation.brush.radius} | Shape ${observation.brush.brushShape} | Material ${observation.brush.materialBlockId} | Face ${observation.brush.targetFace}`}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-dirty-state">
          <h3>Dirty State</h3>
          <p>{`${observation.dirtyChunks} dirty chunks | ${editorState.dirtyState.dirtyAreaIds.length} dirty areas | ${editorState.dirtyState.dirtyPropIds.length} dirty props`}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-history">
          <h3>History And Snapshots</h3>
          <p>{`Undo ${editorState.undoStack.length} | Redo ${editorState.redoStack.length} | Snapshots ${editorState.savedSnapshots.length}`}</p>
          <p>{latestSnapshot ? `Latest: ${latestSnapshot.note}` : "No saved editor snapshots."}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-large-world">
          <h3>Large World Readiness</h3>
          <p>{`Mode: ${editorState.runtimeState} runtime`}</p>
          <p>{`${editorState.largeWorldStats.chunkCount} chunks | ${editorState.largeWorldStats.propCount} props | ${editorState.largeWorldStats.consoleMessageCount} console entries`}</p>
        </article>

        <article className="agent-card" data-testid="agent-section-handoff">
          <h3>LLM Handoff</h3>
          <p>Frontend-only editor shell. Bevy/Tauri bridge remains deferred. Current persistence surface is the mock backend client plus state snapshots.</p>
          <p>World editing coverage includes terrain summaries, protected areas, water parameters, props, atlas mapping, command history, and snapshots.</p>
        </article>

        <article className="agent-card" data-testid="agent-section-warnings">
          <h3>Warnings</h3>
          <ul aria-label="Current warnings">
            {observation.warnings.length > 0 ? (
              observation.warnings.map((warning) => <li key={warning}>{warning}</li>)
            ) : (
              <li>No warnings.</li>
            )}
          </ul>
        </article>

        <article className="agent-card" data-testid="agent-section-suggested-commands">
          <h3>Suggested Commands</h3>
          <p data-testid="agent-suggested-commands-raw">{suggestionList}</p>
          <div className="agent-command-grid">
            {agentCommandIds.map((commandId) => (
              <button
                key={commandId}
                type="button"
                aria-label={`Run ${commandId}`}
                className="toolbar-button"
                data-command-id={commandId}
                onClick={() => void runAgentCommand(commandId)}
              >
                {commandId}
              </button>
            ))}
          </div>
        </article>

        <article className="agent-card" data-testid="agent-section-task-plan">
          <h3>Task Plan</h3>
          <p>Observe {'->'} Plan {'->'} Act {'->'} Verify</p>
          <ol>
            <li>Run Observe Screen.</li>
            <li>Run Plan and choose desired operations.</li>
            <li>Act on plan steps and verify timeline updates.</li>
            <li>Generate checks for mocked test results.</li>
          </ol>
        </article>

        <article className="agent-card" data-testid="agent-section-timeline">
          <h3>Observe {'->'} Plan {'->'} Act {'->'} Verify Timeline</h3>
          <ul aria-label="Agent timeline">
            {timelineRows.length > 0 ? (
              timelineRows.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)
            ) : (
              <li>No timeline entries yet.</li>
            )}
          </ul>
        </article>

        <article className="agent-card" data-testid="agent-section-verification-checklist">
          <h3>Verification Checklist</h3>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("agent observe"))} aria-label="Observation recorded" /> Observation recorded
          </label>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("plan"))} aria-label="Plan executed" /> Plan command run
          </label>
          <label>
            <input type="checkbox" readOnly checked={selected?.kind === "area"} aria-label="Area selected" /> Selected area exists
          </label>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("created and runtime accepted"))} aria-label="Protected area created" /> Protected area created
          </label>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("runtime update accepted") || entry.message.includes("runtime accepted"))} aria-label="Runtime accepted" /> Runtime accepted
          </label>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("Voxel edit blocked by protected area"))} aria-label="Voxel edit blocked" /> Voxel edit blocked
          </label>
          <label>
            <input type="checkbox" readOnly checked={timeline.some((entry) => entry.message.includes("conflict status clear") || entry.message.includes("conflicts clear"))} aria-label="Conflict status clear" /> Conflict status clear
          </label>
          <label>
            <input type="checkbox" readOnly checked={generatedTests.length > 0} aria-label="Test generated" /> Mocked test generated
          </label>
        </article>

        <article className="agent-card" data-testid="agent-section-test-results">
          <h3>Test Results</h3>
          <strong>{TEST_RESULTS_HEADER}</strong>
          <ul aria-label="Generated test results">
            {generatedTests.length > 0 ? generatedTests.map((entry) => <li key={entry}>{entry}</li>) : <li>No tests recorded yet.</li>}
          </ul>
        </article>

        <article className="agent-card" data-testid="agent-section-json-observation">
          <h3>JSON Observation</h3>
          <pre data-testid="agent-json-observation" aria-label="Agent JSON observation">{JSON.stringify(observation, null, 2)}</pre>
        </article>

        <article className="agent-card" data-testid="agent-section-screenshot-placeholders">
          <h3>Before / After Screenshot Placeholders</h3>
          <p>Before: [placeholder mock image]</p>
          <p>After: [placeholder mock image]</p>
        </article>
      </div>
    </section>
  );
}

