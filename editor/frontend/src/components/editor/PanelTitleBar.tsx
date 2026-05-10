import type { ReactNode } from "react";
import { X } from "lucide-react";

interface PanelTitleBarProps {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly onClose?: () => void;
  readonly titleId?: string;
}

export function PanelTitleBar({ title, actions, onClose, titleId }: PanelTitleBarProps) {
  if (!actions && !onClose) {
    return null;
  }

  return (
    <div className="panel-titlebar" aria-label={`${title} panel`}>
      <span className="panel-titlebar-title" id={titleId}>{title}</span>
      <div className="panel-titlebar-actions">
        {actions}
        {onClose ? (
          <button
            type="button"
            className="panel-titlebar-close"
            data-testid={`panel-close-${title.toLowerCase().replace(/\s+/g, "-")}`}
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
