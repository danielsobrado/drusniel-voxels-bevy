import type { ReactNode } from "react";

interface PanelTitleBarProps {
  readonly title: string;
  readonly actions?: ReactNode;
}

export function PanelTitleBar({ title, actions }: PanelTitleBarProps) {
  if (!actions) {
    return null;
  }

  return (
    <div className="panel-titlebar panel-titlebar-actions-only" aria-label={`${title} panel actions`}>
      <span className="sr-only">{title}</span>
      {actions ? <div className="panel-titlebar-actions">{actions}</div> : null}
    </div>
  );
}
