import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";

export function ConsolePanel() {
  const messages = useEditorStore((state) => state.consoleMessages);
  const visibleMessages = messages.slice(0, 250);
  const hiddenCount = Math.max(0, messages.length - visibleMessages.length);

  return (
    <section className="panel-shell" data-testid="panel-console" aria-labelledby="console-title">
      <PanelTitleBar title="Console" />
      <div className="panel-body">
        <h2 id="console-title" className="placeholder-heading">Console</h2>
        <p className="agent-hint">Agent Hint: console entries include runtime bridge events and command errors; clear is available from the palette.</p>
        {hiddenCount > 0 ? <p className="muted" data-testid="console-large-world-cap">{`Showing newest ${visibleMessages.length} of ${messages.length} entries.`}</p> : null}
        {messages.length === 0 ? <p className="muted">Console cleared.</p> : null}
        {visibleMessages.map((message) => (
          <div key={message.id} className={`console-row console-${message.level}`}>
            <span className="console-line">{message.message}</span>
            <span className="console-time">{message.time}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
