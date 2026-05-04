type StatusPillTone = "neutral" | "ok" | "warn" | "bad" | "agent";

interface StatusPillProps {
  readonly children: string;
  readonly tone?: StatusPillTone;
}

export function StatusPill({ children, tone = "neutral" }: StatusPillProps) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
