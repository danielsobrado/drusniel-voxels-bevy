import { useEditorStore } from "../../state/editorStore";

interface ShadowBudgetPanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

export function ShadowBudgetPanel({ render }: ShadowBudgetPanelProps) {
  const shadowBudget = useEditorStore((state) => state.runtimeMetrics.shadowBudget);

  return (
    <section className="inspector-section" data-testid="profiler-shadow-budget">
      <div className="inspector-section-title">Shadow budget</div>
      <p className="inspector-subnote">{shadowBudget.enabled ? "Shadow budget enabled." : "Shadow budget disabled."}</p>
      <button
        type="button"
        className="toolbar-button"
        data-testid="profiler-toggle-shadow-budget"
        onClick={() => void render("editor.debug.toggleShadowBudget")}
      >
        {shadowBudget.enabled ? "Disable shadow budget" : "Enable shadow budget"}
      </button>
    </section>
  );
}
