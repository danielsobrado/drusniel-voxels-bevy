// Agent Workbench panel + Command Palette + Texture Atlas + smaller bits

function AgentWorkbench() {
  const planSteps = [
    { id: 1, t: 'Inspect current viewport selection', s: 'done' },
    { id: 2, t: 'Identify chunks intersecting Story Lock spec', s: 'done' },
    { id: 3, t: 'Create unbreakable box from chunks 18, 19, 20', s: 'active' },
    { id: 4, t: 'Set rules: canMine=false, canPlace=false', s: 'pending' },
    { id: 5, t: 'Rebuild affected chunk meshes', s: 'pending' },
    { id: 6, t: 'Generate Playwright verification test', s: 'pending' },
  ];

  const suggested = [
    { I: Icons.Crosshair, t: 'Select chunk under cursor', id: 'editor.viewport.selectChunkAtCursor' },
    { I: Icons.Shield, t: 'Create unbreakable area from selection', id: 'editor.area.createUnbreakableFromSelection' },
    { I: Icons.Paint, t: 'Paint grass top / dirt side', id: 'editor.voxel.paintGrassDirt' },
    { I: Icons.Spray, t: 'Scatter rocks on slope > 25°', id: 'editor.props.scatterRocksOnSlope' },
    { I: Icons.Refresh, t: 'Rebuild dirty chunks', id: 'editor.world.rebuildDirty' },
    { I: Icons.Beaker, t: 'Run water visual probe', id: 'editor.water.runVisualProbe' },
    { I: Icons.Save, t: 'Save world snapshot', id: 'editor.file.saveSnapshot' },
    { I: Icons.Bug, t: 'Generate Playwright test', id: 'editor.agent.generatePlaywrightTest' },
  ];

  const observation = {
    selection: 'chunks: [18,3,−4], [19,3,−4], [20,3,−4]',
    panels: '4 docked · viewport, outliner, inspector, assets',
    mode: 'Area',
    constraints: 'no-dig, no-build (parent: Story Lock root)',
  };

  return (
    <Panel
      title="Agent Workbench"
      icon={Icons.Bot}
      tabs={[
        { id: 'workbench', label: 'Workbench' },
        { id: 'screen', label: 'Screen' },
        { id: 'history', label: 'History' },
      ]}
      activeTab="workbench"
      agent
      hint={{ agent: true, text: 'Approve each step. The agent never modifies the world without your sign-off.' }}
      testid="panel-agent"
    >
      <div className="insp" style={{ padding: 0 }}>
        <div style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div className="agent-card" style={{ gridColumn: '1 / -1' }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="tag agent"><Icons.Bot size={9} />active</span>
              <span className="muted" style={{ fontSize: 10 }}>claude · sonnet</span>
              <span className="spacer" style={{ flex: 1 }} />
              <Toggle on />
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg)', marginBottom: 4, fontWeight: 500 }}>Agent Mode</div>
            <div className="kv"><span className="k">Safety</span><span className="v" style={{ color: 'var(--ok)' }}>strict</span></div>
            <div className="kv"><span className="k">Approval</span><span className="v">per-step</span></div>
            <div className="kv"><span className="k">Session</span><span className="v">8b32f1</span></div>
          </div>
        </div>

        <InspSection title="Screen Understanding" right={<span className="tag">live</span>}>
          <div className="kv"><span className="k">Mode</span><span className="v" style={{ color: 'var(--accent-strong)' }}>{observation.mode}</span></div>
          <div className="kv"><span className="k">Selection</span><span className="v" style={{ fontSize: 10 }}>{observation.selection}</span></div>
          <div className="kv"><span className="k">Panels</span><span className="v" style={{ fontSize: 10 }}>{observation.panels}</span></div>
          <div className="kv"><span className="k">Constraints</span><span className="v" style={{ fontSize: 10, color: 'var(--bad)' }}>{observation.constraints}</span></div>
        </InspSection>

        <InspSection title="Task">
          <Row label="Goal">
            <input className="text-input" defaultValue="Lock the Ember Sanctum so players can't destroy it." />
          </Row>
          <div className="cap" style={{ padding: '6px 0 4px' }}>Plan · 6 steps</div>
          {planSteps.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}>
              <span style={{
                width: 16, height: 16, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: s.s === 'done' ? 'var(--ok-soft)' : s.s === 'active' ? 'var(--agent-soft)' : 'var(--bg-input)',
                color: s.s === 'done' ? 'var(--ok)' : s.s === 'active' ? 'var(--agent-strong)' : 'var(--fg-4)',
                border: `1px solid ${s.s === 'done' ? 'rgba(54,196,106,0.3)' : s.s === 'active' ? 'rgba(162,108,255,0.4)' : 'var(--border)'}`,
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>
                {s.s === 'done' ? <Icons.Check size={9} sw={2.5} /> : s.id}
              </span>
              <span style={{ color: s.s === 'pending' ? 'var(--fg-3)' : 'var(--fg)', flex: 1 }}>{s.t}</span>
              {s.s === 'active' && <span className="tag agent" style={{ height: 14, fontSize: 9 }}>now</span>}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 8 }}>
            <button className="btn agent">Approve Step</button>
            <button className="btn">Revise</button>
            <button className="btn danger">Reject</button>
          </div>
        </InspSection>

        <InspSection title="Actions" right={<span className="muted" style={{ fontSize: 10 }}>⌘K palette</span>}>
          <div className="tree-search" style={{ height: 22, marginBottom: 4 }}>
            <Icons.Search size={11} />
            <input placeholder="Search commands…" />
          </div>
          {suggested.slice(0, 5).map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 3, fontSize: 11, cursor: 'default' }}>
              <c.I size={11} style={{ color: 'var(--fg-3)' }} />
              <span style={{ flex: 1, color: 'var(--fg-2)' }}>{c.t}</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--fg-4)' }}>{c.id.split('.').slice(-1)[0]}</span>
            </div>
          ))}
        </InspSection>

        <InspSection title="Observation">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
            <div style={{ background: '#0c1015', height: 70, border: '1px solid var(--border)', borderRadius: 3, position: 'relative' }}>
              <svg viewBox="0 0 100 70" width="100%" height="100%">
                <rect width="100" height="40" fill="#1a2638"/><rect y="40" width="100" height="30" fill="#3e6e2c"/>
                <rect x="40" y="35" width="22" height="20" fill="rgba(239,79,94,0.3)" stroke="#ef4f5e" strokeWidth="0.6" strokeDasharray="2 2" />
              </svg>
              <span style={{ position: 'absolute', bottom: 2, left: 3, fontSize: 8, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>screenshot</span>
            </div>
            <div style={{ background: 'var(--bg-input)', height: 70, border: '1px solid var(--border)', borderRadius: 3, padding: 4, fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--fg-3)', overflow: 'hidden' }}>
              <div style={{ color: 'var(--accent-strong)' }}>a11y-snapshot.json</div>
              <div>{`{ tool: "area",`}</div>
              <div>{`  selection: 3,`}</div>
              <div>{`  panel: "inspector",`}</div>
              <div>{`  rule: "unbreakable" }`}</div>
            </div>
          </div>
        </InspSection>

        <InspSection title="Verification">
          <div className="kv"><span className="k">Assertions</span><span className="v" style={{ color: 'var(--ok)' }}>3 / 4 pass</span></div>
          <div className="kv"><span className="k">Visual diff</span><span className="v" style={{ color: 'var(--ok)' }}>1.2%</span></div>
          <div className="kv"><span className="k">FPS delta</span><span className="v" style={{ color: 'var(--warn)' }}>−4 (138 → 134)</span></div>
          <div className="kv"><span className="k">Test artifact</span><span className="v" style={{ fontSize: 10 }}>tests/area-unbreakable.spec.ts</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
            <button className="btn sm">Compare</button>
            <button className="btn pri sm">Approve Changes</button>
          </div>
        </InspSection>
      </div>
    </Panel>
  );
}

// ── Command palette modal ───────────────────────────────────
function CommandPalette() {
  const cmds = [
    { I: Icons.Shield, n: 'Create unbreakable box area', id: 'editor.area.createUnbreakableBox', k: ['⌘','⇧','U'], scope: 'Area Mode' },
    { I: Icons.Grid, n: 'Show chunk bounds', id: 'editor.view.toggleChunkBounds', k: ['G','C'], scope: 'View' },
    { I: Icons.Refresh, n: 'Rebuild selected chunk', id: 'editor.world.rebuildSelectedChunk', k: ['⌘','R'], scope: 'World' },
    { I: Icons.Beaker, n: 'Open water reflection debug', id: 'editor.water.toggleReflectionDebug', k: [], scope: 'Water' },
    { I: Icons.Paint, n: 'Paint selected faces with atlas tile 7', id: 'editor.voxel.paintMaterial', k: ['7'], scope: 'Paint Mode' },
    { I: Icons.Bug, n: 'Run Playwright viewport smoke test', id: 'editor.tests.runViewportSmoke', k: [], scope: 'Tests' },
    { I: Icons.Bot, n: 'Ask Agent to explain current selection', id: 'editor.agent.explainSelection', k: ['⌘','⇧','A'], scope: 'Agent', agent: true },
    { I: Icons.Save, n: 'Save world snapshot', id: 'editor.file.saveSnapshot', k: ['⌘','S'], scope: 'File' },
  ];
  return (
    <div style={{
      position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
      width: 600, maxHeight: 460, background: 'var(--bg-elev)',
      border: '1px solid var(--border-strong)', borderRadius: 6,
      boxShadow: 'var(--shadow-3)', overflow: 'hidden', zIndex: 50,
    }} data-testid="command-palette">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <Icons.Search size={14} style={{ color: 'var(--fg-3)' }} />
        <input
          autoFocus
          defaultValue="unbreakable"
          style={{ flex: 1, background: 'transparent', border: 0, outline: 0, color: 'var(--fg)', fontSize: 14 }}
          placeholder="Type a command or ask the agent…"
        />
        <span className="kbd">esc</span>
      </div>
      <div className="cap" style={{ padding: '6px 14px 4px', borderBottom: '1px solid var(--border-soft)' }}>Commands · 8 results</div>
      <div style={{ maxHeight: 380, overflow: 'auto' }}>
        {cmds.map((c, i) => (
          <div
            key={c.id}
            style={{
              display: 'grid', gridTemplateColumns: '20px 1fr auto auto', gap: 10,
              alignItems: 'center', padding: '7px 14px',
              background: i === 0 ? 'var(--accent-soft)' : 'transparent',
              borderLeft: i === 0 ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'default',
            }}
          >
            <c.I size={14} style={{ color: c.agent ? 'var(--agent-strong)' : i === 0 ? 'var(--accent-strong)' : 'var(--fg-3)' }} />
            <div>
              <div style={{ color: 'var(--fg)', fontSize: 12 }}>{c.n}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--fg-4)' }}>{c.id} · {c.scope}</div>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {c.k.map((kk) => <span key={kk} className="kbd">{kk}</span>)}
            </div>
            {c.agent && <span className="tag agent" style={{ height: 14 }}><Icons.Bot size={9} />agent</span>}
            {!c.agent && <span style={{ width: 0 }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--fg-4)' }}>
        <span><span className="kbd">↵</span> run</span>
        <span><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
        <span><span className="kbd">⌘</span><span className="kbd">↵</span> ask agent</span>
        <span style={{ flex: 1 }} />
        <span>stable command IDs · agent-callable</span>
      </div>
    </div>
  );
}

// ── Texture Atlas editor (paint screen)
function TextureAtlas({ selectedTile = 7 }) {
  const tiles = Array.from({ length: 64 });
  const tileColors = ['#5a8c3a','#76ad4d','#3a6324','#8a5a3a','#a36c46','#5e3d27','#7a7e85','#9aa0a8',
    '#52565d','#d8c389','#ebd8a3','#a89465','#e6ecf2','#bcc4cd','#3e6e2c','#284a1c'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', height: '100%', minHeight: 0 }}>
      <div style={{ overflow: 'auto', padding: 10 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="cap">Atlas · terrain_main.png · 8×8 · 256px tiles</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm"><Icons.Pipette size={11} /> Pick</button>
          <button className="btn sm"><Icons.Plus size={11} /> Import Tile</button>
          <button className="btn pri sm"><Icons.Save size={11} /> Save to YAML</button>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 2, background: 'var(--bg-input)', padding: 4, borderRadius: 4,
          border: '1px solid var(--border)',
        }}>
          {tiles.map((_, i) => {
            const c = tileColors[i % tileColors.length];
            const sel = i === selectedTile;
            return (
              <div
                key={i}
                style={{
                  aspectRatio: '1/1',
                  background: c,
                  position: 'relative',
                  border: sel ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.4)',
                  boxShadow: sel ? '0 0 0 1px var(--accent-soft), 0 0 12px var(--accent-glow)' : 'none',
                  borderRadius: 2,
                }}
                data-testid={`atlas-tile-${i}`}
              >
                <span style={{
                  position: 'absolute', top: 1, left: 2,
                  fontSize: 8, fontFamily: 'var(--font-mono)',
                  color: 'rgba(0,0,0,0.6)', fontWeight: 700,
                }}>{i.toString().padStart(2, '0')}</span>
                {sel && <span style={{
                  position: 'absolute', bottom: 1, right: 2,
                  fontSize: 8, color: '#fff', fontFamily: 'var(--font-mono)',
                  fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.6)'
                }}>SEL</span>}
              </div>
            );
          })}
        </div>
        <div className="hr" />
        <div className="cap" style={{ marginBottom: 4 }}>Top / Side / Bottom assignment · selected: tile_07 (Grass Top)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { l: 'TOP', t: 7, c: '#5a8c3a' },
            { l: 'SIDE', t: 18, c: '#8a5a3a' },
            { l: 'BOTTOM', t: 18, c: '#5e3d27' },
          ].map((s) => (
            <div key={s.l} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, padding: 6 }}>
              <div className="cap" style={{ marginBottom: 4 }}>{s.l}</div>
              <div className="row">
                <div style={{ width: 32, height: 32, background: s.c, borderRadius: 2, border: '1px solid rgba(0,0,0,0.4)' }} />
                <div className="col" style={{ gap: 0 }}>
                  <span className="num" style={{ fontSize: 11 }}>tile_{s.t.toString().padStart(2,'0')}</span>
                  <span className="muted" style={{ fontSize: 10 }}>change</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 3D preview */}
      <div style={{ borderLeft: '1px solid var(--border-soft)', padding: 10, overflow: 'auto' }}>
        <div className="cap" style={{ marginBottom: 6 }}>3D Preview</div>
        <div style={{ background: '#0c1015', border: '1px solid var(--border)', borderRadius: 3, height: 180, position: 'relative', overflow: 'hidden' }}>
          <svg viewBox="0 0 200 180" width="100%" height="100%">
            <defs>
              <radialGradient id="bg" cx="50%" cy="40%"><stop offset="0%" stopColor="#1a2638"/><stop offset="100%" stopColor="#0c1015"/></radialGradient>
            </defs>
            <rect width="200" height="180" fill="url(#bg)" />
            {/* Block */}
            <g transform="translate(100, 90)">
              <path d="M0,-40 L40,-20 L0,0 L-40,-20 Z" fill="#5a8c3a" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
              <path d="M0,0 L40,-20 L40,30 L0,50 Z" fill="#8a5a3a" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
              <path d="M0,0 L-40,-20 L-40,30 L0,50 Z" fill="#5e3d27" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
              <path d="M0,-40 L40,-20 L0,0 L-40,-20 Z" fill="rgba(255,255,255,0.06)" />
            </g>
          </svg>
          <span style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 9, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>drag to rotate · 1.2x</span>
        </div>
        <div className="hr" />
        <div className="kv"><span className="k">Block ID</span><span className="v">block_grass</span></div>
        <div className="kv"><span className="k">Atlas</span><span className="v">terrain_main</span></div>
        <div className="kv"><span className="k">Tiles</span><span className="v">7 / 18 / 18</span></div>
        <div className="kv"><span className="k">UV scale</span><span className="v">1.000</span></div>
        <div className="hr" />
        <button className="btn full sm" style={{ marginBottom: 4 }}><Icons.Cube size={11} /> Apply to selection</button>
        <button className="btn full sm pri">Save block to YAML</button>
      </div>
    </div>
  );
}

// ── Voxel palette mini panel
function VoxelPaletteStrip() {
  const blocks = [
    { c: '#5a8c3a', n: 'Grass' }, { c: '#8a5a3a', n: 'Dirt' },
    { c: '#7a7e85', n: 'Stone' }, { c: '#d8c389', n: 'Sand' },
    { c: '#e6ecf2', n: 'Snow' }, { c: '#5a3a22', n: 'Wood' },
    { c: '#3e6e2c', n: 'Leaves' }, { c: '#3a85b8', n: 'Water' },
  ];
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {blocks.map((b, i) => (
        <div key={b.n} style={{ position: 'relative' }} title={b.n}>
          <div style={{
            width: 22, height: 22,
            background: b.c, borderRadius: 3,
            border: i === 0 ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.4)',
            boxShadow: i === 0 ? '0 0 0 1px var(--accent-soft)' : 'none',
          }} />
        </div>
      ))}
    </div>
  );
}

window.AgentWorkbench = AgentWorkbench;
window.CommandPalette = CommandPalette;
window.TextureAtlas = TextureAtlas;
window.VoxelPaletteStrip = VoxelPaletteStrip;
