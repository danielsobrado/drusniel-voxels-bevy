interface BlockPreview3DProps {
  readonly tileTop: string;
  readonly tileSide: string;
  readonly tileBottom: string;
  readonly label: string;
}

export function BlockPreview3D({ label, tileBottom, tileSide, tileTop }: BlockPreview3DProps) {
  return (
    <section className="block-preview3d" aria-label={`${label} tile preview`} data-testid={`block-preview-${label.toLowerCase()}`}>
      <h3 className="inspector-section-title">{label}</h3>
      <svg className="block-preview3d-svg" viewBox="0 0 140 150" role="img">
        <defs>
          <linearGradient id="preview-shadow" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(255, 255, 255, 0.55)" />
            <stop offset="1" stopColor="rgba(0, 0, 0, 0.55)" />
          </linearGradient>
        </defs>
        <rect x="20" y="15" width="30" height="30" fill="rgba(255,255,255,0.1)" stroke="currentColor" />
        <rect x="26" y="18" width="55" height="55" fill="url(#preview-shadow)" stroke="rgba(230, 232, 236, 0.45)" />
        <rect x="26" y="66" width="55" height="34" fill="rgba(0, 0, 0, 0.35)" stroke="rgba(230, 232, 236, 0.25)" />
        <rect x="58" y="36" width="55" height="34" fill="rgba(230, 232, 236, 0.12)" stroke="rgba(230, 232, 236, 0.45)" />
        <text x="56" y="110" fill="var(--editor-fg-2)" fontSize="10">
          {`top: ${tileTop}`}
        </text>
        <text x="56" y="122" fill="var(--editor-fg-2)" fontSize="10">
          {`side: ${tileSide}`}
        </text>
        <text x="56" y="134" fill="var(--editor-fg-2)" fontSize="10">
          {`bottom: ${tileBottom}`}
        </text>
      </svg>
    </section>
  );
}
