// Viewport with overlays — tool shelf, breadcrumbs, gizmos, status, contextual strip.
const { useState: vUseState } = React;

function ViewportShell({ variant = 'default', tool = 'select', overlays = {}, breadcrumb, contextStrip, agent }) {
  const tools = [
    { id: 'select', I: Icons.Cursor, label: 'Select' },
    { id: 'sculpt', I: Icons.Sculpt, label: 'Sculpt' },
    { id: 'paint', I: Icons.Paint, label: 'Paint' },
    { id: 'area', I: Icons.AreaBox, label: 'Area Volume' },
    { id: 'props', I: Icons.Tree, label: 'Prop Brush' },
    { id: 'water', I: Icons.Water, label: 'Water Brush' },
    { id: 'measure', I: Icons.Ruler, label: 'Measure' },
    { id: 'camera', I: Icons.Camera, label: 'Camera' },
  ];
  const bc = breadcrumb || [
    { label: 'World', I: Icons.Globe },
    { label: 'Region 02', I: Icons.Map },
    { label: 'Chunk [16,3,−4]', I: Icons.Cube },
    { label: 'Selection', I: Icons.Crosshair },
  ];

  return (
    <div className="vp" data-testid="viewport">
      <VoxelScene variant={variant} overlays={overlays} />

      {/* Tool shelf */}
      <div className="vp-shelf" data-testid="viewport-tool-shelf">
        {tools.map((t) => (
          <button
            key={t.id}
            className={`ibtn ${tool === t.id ? 'active' : ''}`}
            title={t.label}
            data-testid={`vp-tool-${t.id}`}
          >
            <t.I size={14} />
          </button>
        ))}
      </div>

      {/* Breadcrumbs (top-left) */}
      <div className="vp-overlay" style={{ top: 8, left: 50, padding: '4px 8px' }}>
        <div className="row" style={{ gap: 4, fontSize: 11 }}>
          {bc.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icons.ChevR size={10} style={{ color: 'var(--fg-4)' }} />}
              {b.I && <b.I size={11} style={{ color: 'var(--fg-3)' }} />}
              <span style={{ color: i === bc.length - 1 ? 'var(--fg)' : 'var(--fg-2)' }}>{b.label}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Gizmos top-right: persp/ortho, view cube, sun */}
      <div className="vp-overlay" style={{ top: 8, right: 8, padding: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
        <div className="seg" style={{ height: 22 }}>
          <button className="active" title="Perspective"><span style={{ fontSize: 10 }}>Persp</span></button>
          <button title="Orthographic"><span style={{ fontSize: 10 }}>Ortho</span></button>
        </div>
        <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
        {/* Mini view cube */}
        <svg width="36" height="36" viewBox="0 0 36 36">
          <g transform="translate(18, 18)">
            <path d="M0 -10 L10 -5 L0 0 L-10 -5 Z" fill="#2a3140" stroke="#4ec5ff" strokeWidth="0.8" />
            <path d="M0 0 L10 -5 L10 5 L0 10 Z" fill="#1f2632" stroke="#3a4252" strokeWidth="0.8" />
            <path d="M0 0 L-10 -5 L-10 5 L0 10 Z" fill="#171c25" stroke="#3a4252" strokeWidth="0.8" />
            <text x="0" y="-3" fontSize="6" fill="#4ec5ff" textAnchor="middle" fontFamily="JetBrains Mono">TOP</text>
            <text x="5" y="3" fontSize="5" fill="#7e8591" textAnchor="middle" fontFamily="JetBrains Mono">N</text>
          </g>
        </svg>
        <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <button className="ibtn" title="Time of day"><Icons.Sun size={13} /></button>
        <span className="num" style={{ fontSize: 10, color: 'var(--fg-2)' }}>14:30</span>
      </div>

      {/* Bottom-left status */}
      <div className="vp-overlay" style={{ bottom: 8, left: 50, padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <span><span style={{ color: 'var(--fg-4)' }}>cam</span> 128.4 64.0 −96.7</span>
          <span><span style={{ color: 'var(--fg-4)' }}>vox</span> <span style={{ color: 'var(--accent-strong)' }}>x:512 y:48 z:−128</span></span>
          <span><span style={{ color: 'var(--fg-4)' }}>id</span> #e0184</span>
        </div>
      </div>

      {/* Bottom-center contextual tool strip */}
      {contextStrip && (
        <div className="vp-overlay" style={{ bottom: 8, left: '50%', transform: 'translateX(-50%)', padding: '4px 6px' }}>
          {contextStrip}
        </div>
      )}

      {/* Bottom-right minimap + LOD */}
      <div className="vp-overlay" style={{ bottom: 8, right: 8, padding: 4 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 86, height: 70, background: '#0c1015', border: '1px solid var(--border)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
            <svg viewBox="0 0 86 70" width="86" height="70">
              <defs>
                <radialGradient id="mm-g" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#3e6e2c" />
                  <stop offset="60%" stopColor="#5a8c3a" />
                  <stop offset="80%" stopColor="#d8c389" />
                  <stop offset="100%" stopColor="#1f5d8c" />
                </radialGradient>
              </defs>
              <rect width="86" height="70" fill="#1f5d8c" />
              <ellipse cx="43" cy="35" rx="32" ry="26" fill="url(#mm-g)" />
              <rect x="2" y="2" width="82" height="66" fill="none" stroke="rgba(78,197,255,0.2)" strokeWidth="0.5" strokeDasharray="2 2" />
              <circle cx="43" cy="35" r="2" fill="#4ec5ff" />
              <path d="M43 35 L52 28 L43 30 L34 28 Z" fill="rgba(78,197,255,0.5)" />
            </svg>
          </div>
          <div className="col" style={{ gap: 2, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--fg-4)' }}>LOD</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {['L0','L1','L2','L3'].map((l, i) => (
                <span key={l} style={{ color: i < 2 ? 'var(--ok)' : 'var(--fg-3)' }}>● {l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Agent banner overlay (variant=agent) */}
      {agent && (
        <div className="vp-overlay" style={{ top: 8, left: '50%', transform: 'translateX(-50%)', padding: '4px 10px', borderColor: 'rgba(162,108,255,0.4)', background: 'rgba(34,20,50,0.85)' }}>
          <div className="row" style={{ gap: 6, fontSize: 11, color: 'var(--agent-strong)' }}>
            <Icons.Bot size={12} />
            <span>Agent is observing — Step 3/6: <span style={{ color: '#fff' }}>Select chunks for unbreakable area</span></span>
            <span className="kbd">Esc</span><span style={{ color: 'var(--fg-3)' }}>to take over</span>
          </div>
        </div>
      )}
    </div>
  );
}

window.ViewportShell = ViewportShell;
