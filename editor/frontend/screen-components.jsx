// Component library screen + Tokens screen — references for design system

function ScreenComponents() {
  const colors = [
    { n: 'bg-app', v: '#0d0f12' },
    { n: 'bg-canvas', v: '#101215' },
    { n: 'bg-panel', v: '#181b20' },
    { n: 'bg-panel-2', v: '#1d2026' },
    { n: 'bg-elev', v: '#20242b' },
    { n: 'border', v: '#2a2e36' },
    { n: 'border-strong', v: '#353a43' },
    { n: 'fg', v: '#e6e8ec' },
    { n: 'fg-2', v: '#b3b8c2' },
    { n: 'fg-3', v: '#7e8591' },
  ];
  const accents = [
    { n: 'accent (cyan)', v: '#2cb8ff' },
    { n: 'warn', v: '#f5a524' },
    { n: 'ok', v: '#36c46a' },
    { n: 'bad', v: '#ef4f5e' },
    { n: 'agent (violet)', v: '#a26cff' },
  ];

  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 0, overflow: 'auto' }} data-screen-label="06 Component Library">
      <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Drusniel Voxels Editor — Design System</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Tokens, controls, and panel primitives. Every interactive element exposes a stable <span className="mono">data-testid</span> and accessible name.</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Colors */}
          <div className="panel">
            <div className="panel-tb"><span className="title">Colors · Surfaces</span></div>
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {colors.map(c => (
                <div key={c.n} className="row" style={{ padding: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 3, background: c.v, border: '1px solid rgba(255,255,255,0.1)' }} />
                  <div className="col" style={{ gap: 0 }}>
                    <span style={{ fontSize: 11 }}>{c.n}</span>
                    <span className="mono muted" style={{ fontSize: 10 }}>{c.v}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-tb"><span className="title">Colors · Status & Selection</span></div>
            <div style={{ padding: 12 }}>
              <div className="cap" style={{ marginBottom: 6 }}>Accents</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 12 }}>
                {accents.map(c => (
                  <div key={c.n} className="col" style={{ gap: 4 }}>
                    <div style={{ height: 36, borderRadius: 3, background: c.v }} />
                    <span style={{ fontSize: 10 }}>{c.n}</span>
                    <span className="mono muted" style={{ fontSize: 9 }}>{c.v}</span>
                  </div>
                ))}
              </div>
              <div className="cap" style={{ marginBottom: 6 }}>Selection / outline colors</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {[['cyan','#4ec5ff','selected'],['green','#36c46a','valid'],['red','#ef4f5e','invalid'],['amber','#f5a524','warning'],['violet','#b787ff','AI target']].map(([n,v,d]) => (
                  <div key={n} className="col" style={{ gap: 3, alignItems: 'center', padding: 6, border: '1px solid var(--border)', borderRadius: 3 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 3, border: `2px solid ${v}`, background: 'rgba(255,255,255,0.02)' }} />
                    <span style={{ fontSize: 10 }}>{n}</span>
                    <span className="muted" style={{ fontSize: 9 }}>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Type */}
          <div className="panel">
            <div className="panel-tb"><span className="title">Typography</span></div>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 16, color: 'var(--fg)', marginBottom: 4 }}>Inter — UI / labels</div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>Optical adjustments, ss01 enabled. Size scale 10/11/12/13/14/16.</div>
              <div className="mono" style={{ fontSize: 16, color: 'var(--fg)', marginBottom: 4 }}>JetBrains Mono — numbers, IDs</div>
              <div className="muted mono" style={{ fontSize: 11 }}>0123456789 · tabular · zero=0 · IDs like editor.area.createUnbreakableBox</div>
              <div className="hr" />
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 4, fontSize: 11 }}>
                <span className="muted">2xs · 10px</span><span style={{ fontSize: 10 }}>STATUS BAR · TIMESTAMPS</span>
                <span className="muted">xs · 11px</span><span style={{ fontSize: 11 }}>Toolbar, tabs, inspector labels</span>
                <span className="muted">sm · 12px</span><span style={{ fontSize: 12 }}>Body / tree rows</span>
                <span className="muted">md · 13px</span><span style={{ fontSize: 13 }}>Panel titles, focused buttons</span>
                <span className="muted">lg · 14px</span><span style={{ fontSize: 14 }}>Section headers</span>
                <span className="muted">xl · 16px</span><span style={{ fontSize: 16 }}>Modal / palette input</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="panel">
            <div className="panel-tb"><span className="title">Controls</span></div>
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px 12px', fontSize: 11 }}>
              <span className="muted">Buttons</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button className="btn pri">Primary</button>
                <button className="btn">Default</button>
                <button className="btn ghost">Ghost</button>
                <button className="btn danger">Delete</button>
                <button className="btn agent"><Icons.Bot size={10} />Ask Agent</button>
                <button className="btn sm">Small</button>
              </div>
              <span className="muted">Icon buttons</span>
              <div className="row">
                <button className="ibtn"><Icons.Save size={14} /></button>
                <button className="ibtn active"><Icons.Cube size={14} /></button>
                <button className="ibtn lg"><Icons.Bot size={16} /></button>
              </div>
              <span className="muted">Segmented</span>
              <div className="seg"><button className="active">A</button><button>B</button><button>C</button></div>
              <span className="muted">Dropdown</span>
              <div className="row"><span className="ddn"><Icons.Zap size={11} />High</span><Sel value="Sphere" options={['Sphere','Cube','Cylinder']} /></div>
              <span className="muted">Slider</span>
              <Slider value={0.55} />
              <span className="muted">Toggle / Check</span>
              <div className="row" style={{ gap: 12 }}><Toggle on /><Toggle on={false} /><Chk on label="enabled" /><Chk on={false} label="off" /></div>
              <span className="muted">Numeric / Vec3</span>
              <div className="col" style={{ gap: 4 }}>
                <input className="num-input" defaultValue="64.000" style={{ width: 100 }} />
                <Vec3 x="128.0" y="48.0" z="−96.0" />
              </div>
              <span className="muted">Tags</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <span className="tag">default</span>
                <span className="tag cyan">selected</span>
                <span className="tag ok">valid</span>
                <span className="tag warn">dirty</span>
                <span className="tag bad">unbreakable</span>
                <span className="tag agent"><Icons.Bot size={9} />agent</span>
              </div>
              <span className="muted">Status pills</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <StatusPill tone="ok">142 fps</StatusPill>
                <StatusPill tone="warn">3 dirty</StatusPill>
                <StatusPill tone="bad">err 1</StatusPill>
                <StatusPill tone="agent">agent</StatusPill>
              </div>
              <span className="muted">Keyboard chips</span>
              <div className="row"><span className="kbd">⌘</span><span className="kbd">K</span><span className="muted">·</span><span className="kbd">⇧</span><span className="kbd">Esc</span></div>
            </div>
          </div>

          {/* Tree row */}
          <div className="panel">
            <div className="panel-tb"><span className="title">Outliner Tree Item</span></div>
            <div style={{ padding: 8 }}>
              <TreeItem depth={0} icon={Icons.Globe} name="World" expanded={true} meta="32 km²" />
              <TreeItem depth={1} icon={Icons.Layers} name="Terrain" expanded={true} />
              <TreeItem depth={2} icon={Icons.Cube} name="Chunk [16,3,−4]" selected dirty />
              <TreeItem depth={2} icon={Icons.Cube} name="Chunk [17,3,−4]" />
              <TreeItem depth={1} icon={Icons.Shield} name="Story Lock" locked badges={<span className="tag bad" style={{ height: 14, fontSize: 9 }}>UNBREAKABLE</span>} />
            </div>
          </div>

          {/* Inspector row */}
          <div className="panel">
            <div className="panel-tb"><span className="title">Inspector Section + Property Row</span></div>
            <div className="insp">
              <InspSection title="Transform">
                <Row label="Position"><Vec3 x="512.0" y="48.0" z="−128.0" /></Row>
                <Row label="Rotation"><Vec3 x="0" y="90" z="0" /></Row>
                <Row label="Scale"><Vec3 x="1.0" y="1.0" z="1.0" /></Row>
              </InspSection>
              <InspSection title="Settings">
                <Row label="Strength"><Slider value={0.65} /></Row>
                <Row label="Snap"><Toggle on /></Row>
                <Row label="Mode"><Sel value="Add" options={['Add','Subtract','Replace']} /></Row>
              </InspSection>
            </div>
          </div>

          {/* Component map */}
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <div className="panel-tb"><span className="title">Component → Implementation map</span></div>
            <div style={{ padding: 12, fontSize: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px 12px' }}>
                <div className="cap">Component</div><div className="cap">Library</div><div className="cap">data-testid</div><div className="cap">Notes</div>
                {[
                  ['DockedPanel','dockview-react','panel-{id}','Title bar + tabs + body. Pin/options/close.'],
                  ['EditorMenubar','shadcn Menubar','editor-menubar','13 menus + brand + right pills.'],
                  ['MainToolbar','custom (shadcn primitives)','main-toolbar','Tool/Transform segmented, brush, FPS pills.'],
                  ['ViewportShell','@react-three/fiber','viewport','Bevy canvas placeholder + overlays.'],
                  ['ToolShelf','custom','viewport-tool-shelf','Vertical icon shelf inside viewport.'],
                  ['WorldOutliner','TanStack Virtual','outliner-tree','Virtualized tree, search, filters.'],
                  ['OutlinerTreeItem','custom','tree-item-{id}','Visibility/lock toggles, dirty badge.'],
                  ['InspectorSection','shadcn Collapsible','insp-{id}','Collapsible group with right slot.'],
                  ['NumericVector3Field','shadcn Input','vec3-{name}','XYZ tinted axis labels.'],
                  ['RuleMatrix','custom','rule-{name}','3-col grid: rule / chk / allow|deny.'],
                  ['BrushControls','custom','brush-controls','Shape/radius/strength/falloff.'],
                  ['VoxelPalette','TanStack Virtual','voxel-palette','Block grid with 3D preview chip.'],
                  ['TextureAtlasGrid','custom','atlas-tile-{i}','8×8 grid + selection ring.'],
                  ['AssetBrowser','TanStack Table+Virtual','panel-bottom','Cats / grid / metadata.'],
                  ['MaterialPreview','@react-three/drei','material-preview','Sphere/cube/terrain previews.'],
                  ['WaterBodyInspector','custom','insp-water','Reflection/foam/debug groups.'],
                  ['ProtectedAreaInspector','custom','insp-area','Rule matrix + audit log.'],
                  ['ProfilerPanel','custom (chart)','panel-profiler','Frame graph + timing table.'],
                  ['ConsolePanel','TanStack Virtual','panel-console','Severity, source, filters.'],
                  ['AgentWorkbench','custom','panel-agent','Observe/Plan/Act/Verify sections.'],
                  ['CommandPalette','cmdk + shadcn','command-palette','⌘K · stable command IDs.'],
                  ['TestRunPanel','custom','panel-tests','Playwright runs + before/after.'],
                ].map((row,i) => row.map((c,j) => (
                  <div key={`${i}-${j}`} style={{ padding: '3px 0', borderBottom: '1px solid var(--border-soft)', color: j === 0 ? 'var(--fg)' : j === 2 ? 'var(--accent-strong)' : 'var(--fg-2)', fontFamily: j === 2 ? 'var(--font-mono)' : undefined, fontSize: j === 2 ? 10 : 11 }}>{c}</div>
                )))}
              </div>
            </div>
          </div>

          {/* State shape */}
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <div className="panel-tb"><span className="title">Example state shape (Zustand)</span></div>
            <pre className="mono" style={{ padding: 12, margin: 0, fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{
`type EditorState = {
  activeTool: 'select' | 'sculpt' | 'paint' | 'area' | 'props' | 'water' | 'build' | 'measure';
  transform: 'move' | 'rotate' | 'scale';
  selection: { kind: 'voxel' | 'chunk' | 'area' | 'water' | 'prop'; id: string; data: unknown } | null;
  brush: { shape: 'sphere'|'cube'|'cylinder'; radius: number; strength: number; falloff: number };
  view: { showGrid: boolean; showChunkBounds: boolean; showCollision: boolean; showProtection: boolean };
  agent: { enabled: boolean; safety: 'strict'|'lenient'; approval: 'per-step'|'auto'; sessionId: string };
  agentLog: Array<{ phase: 'observe'|'plan'|'act'|'verify'; ts: number; msg: string; commandId?: string }>;
  cmdK: { open: boolean; query: string; recents: string[] };
};`
            }</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ScreenComponents = ScreenComponents;
