import { Fragment } from "react";
import type { RenderTimingSample } from "../../types/runtime";

interface RenderTimingTableProps {
  readonly samples: readonly RenderTimingSample[];
}

function RenderTimingRow({ sample }: { readonly sample: RenderTimingSample }) {
  return (
    <div className="readout-row">
      <span>{sample.label}</span>
      <strong>{sample.ms} ms</strong>
      <small className="muted">[{sample.category}]</small>
    </div>
  );
}

export function RenderTimingTable({ samples }: RenderTimingTableProps) {
  return (
    <section className="inspector-section" data-testid="render-timing-table">
      <div className="inspector-section-title">Render timing table</div>
      <div className="inspector-metric-grid">
        {samples.length === 0 ? <p className="inspector-subnote">No runtime timing rows.</p> : null}
        {samples.map((sample) => (
          <Fragment key={`${sample.label}-${sample.ms}`}>
            <RenderTimingRow sample={sample} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}
