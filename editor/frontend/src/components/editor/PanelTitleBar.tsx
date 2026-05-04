import type { ReactNode } from "react";

interface PanelTitleBarProps {
  readonly title: string;
  readonly actions?: ReactNode;
}

export function PanelTitleBar({ title, actions }: PanelTitleBarProps) {
  return (
    <div className="panel-titlebar">
      <span>{title}</span>
      {actions ? <div className="panel-titlebar-actions">{actions}</div> : null}
    </div>
  );
}
