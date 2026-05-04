// Refinement screens — additional inspector states, screen states, palette,
// agent workbench redesign, dock spec, a11y/testid conventions.

const { useState: rUseState } = React;

// ── Refined Command Palette (categorized, agent-aware, with preview pane)
function CommandPaletteRefined({ query = 'unbreakable', mode = 'cmd' }) {
  const groups = [
    {
      cap: 'Suggested · agent', tone: 'agent',
      items: [
        { I: Icons.Bot, n: 'Lock the Ember Sanctum so players can\u2019t destroy it', meta: 'multi-step plan · 6 steps', k: ['\u2318','\u21A9'], scope: 'Agent', agent: true, sel: true },
        { I: Icons.Wand, n: 'Generate Playwright test from current selection', meta: 'agent · verify', scope: 'Agent', agent: true },
      ]
    },
    {
      cap: 'Areas · 3 results', tone: 'cmd',
      items: [
        { I: Icons.Shield, n: 'Create unbreakable box area', meta: 'editor.area.createUnbreakableBox', k: ['\u2318','\u21E7','U'], scope: 'Area Mode' },
        { I: Icons.AreaBox, n: 'Create no-dig zone from selection', meta: 'editor.area.createNoDigFromSel', scope: 'Area Mode' },
        { I: Icons.Lock, n: 'Toggle quest lock on selected area', meta: 'editor.area.toggleQuestLock', scope: 'Areas' },
      ]
    },
    {
      cap: 'World · 2 results', tone: 'cmd',
      items: [
        { I: Icons.Refresh, n: 'Rebuild selected chunk', meta: 'editor.world.rebuildSelectedChunk', k: ['\u2318','R'], scope: 'World' },
        { I: Icons.Refresh, n: 'Rebuild all dirty chunks', meta: 'editor.world.rebuildDirty', k: ['\u2318','\u21E7','R'], scope: 'World' },
      ]
    },
  ];

  return (
    <div style={{
      position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
      width: 720, maxHeight: 520, background: 'var(--bg-elev)',
      border: '1px solid var(--border-strong)', borderRadius: 8,
      boxShadow: 'var(--shadow-3)', overflow: 'hidden', zIndex: 50,
    }} data-testid="command-palette" role="dialog" aria-label="Command palette">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <span className="seg" style={{ height: 22 }}>
          <button className={mode === 'cmd' ? 'active' : ''}><span style={{ fontSize: 10 }}>Cmd</span></button>
          <button className={mode === 'ask' ? 'active' : ''}><Icons.Bot size={10} /><span style={{ fontSize: 10 }}>Ask</span></button>
          <button><Icons.Search size={10} /><span style={{ fontSize: 10 }}>Find</span></button>
        </span>
        <div className="div" style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <Icons.Search size={14} style={{ color: 'var(--fg-3)' }} />
        <input
          autoFocus
          defaultValue={query}
          aria-label="Command query"
          style={{ flex: 1, background: 'transparent', border: 0, outline: 0, color: 'var(--fg)', fontSize: 14 }}
          placeholder="Type a command, or @agent to ask…"
        />
        <span className="tag agent"><Icons.Bot size={9} />⌘↵ ask</span>
        <span className="kbd">esc</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', minHeight: 0 }}>
        <div style={{ maxHeight: 420, overflow: 'auto', borderRight: '1px solid var(--border-soft)' }}>
          {groups.map((g) => (
            <div key={g.cap}>
              <div className="cap" style={{ padding: '6px 14px 4px', position: 'sticky', top: 0, background: 'var(--bg-elev)', borderBottom: '1px solid var(--border-soft)' }}>{g.cap}</div>
              {g.items.map((c, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 10,
                  alignItems: 'center', padding: '8px 14px',
                  background: c.sel ? 'var(--accent-soft)' : 'transparent',
                  borderLeft: c.sel ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                  <c.I size={14} style={{ color: c.agent ? 'var(--agent-strong)' : c.sel ? 'var(--accent-strong)' : 'var(--fg-3)' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--fg)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.n}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--fg-4)' }}>{c.meta} · {c.scope}</div>
                  </div>
                  <div className="row" style={{ gap: 3 }}>
                    {c.agent && <span className="tag agent" style={{ height: 14 }}><Icons.Bot size={9} />agent</span>}
                    {(c.k || []).map((kk, j) => <span key={j} className="kbd">{kk}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Preview pane */}
        <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-2)' }}>
          <div className="cap" style={{ marginBottom: 6 }}>Preview · selected command</div>
          <div className="agent-card" style={{ marginBottom: 8 }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <Icons.Bot size={12} style={{ color: 'var(--agent-strong)' }} />
              <span style={{ color: 'var(--agent-strong)', fontSize: 11, fontWeight: 600 }}>Agent will</span>
            </div>
            <div style={{ fontSize: 11 }}>Draft a 6-step plan, request your approval per step, and generate a verification test.</div>
          </div>
          <div className="cap" style={{ marginBottom: 4 }}>Inputs</div>
          <div className="kv"><span className="k">Selection</span><span className="v">3 chunks</span></div>
          <div className="kv"><span className="k">Mode</span><span className="v">Area</span></div>
          <div className="kv"><span className="k">Constraints</span><span className="v" style={{ color: 'var(--bad)' }}>no-dig, no-build</span></div>
          <div className="hr" />
          <div className="cap" style={{ marginBottom: 4 }}>Effects</div>
          <ul style={{ margin: 0, padding: '0 0 0 14px', color: 'var(--fg-3)', fontSize: 11 }}>
            <li>Creates 1 protected area</li>
            <li>Sets 6 rules (deny mine/place/paint/…)</li>
            <li>Marks 3 chunks dirty for remesh</li>
          </ul>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--fg-4)', background: 'var(--bg-panel-2)' }}>
        <span><span className="kbd">↵</span> run</span>
        <span><span className="kbd">↑</span><span className="kbd">↓</span> nav</span>
        <span><span className="kbd">⌥</span><span className="kbd">↵</span> dry-run</span>
        <span><span className="kbd">⌘</span><span className="kbd">↵</span> ask agent</span>
        <span style={{ flex: 1 }} />
        <span>data-testid <span className="mono">command-palette</span> · stable IDs</span>
      </div>
    </div>
  );
}

// ── Screen 6: Inspector states matrix
function ScreenInspectorStates() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 24, overflow: 'auto' }} data-screen-label="06 Inspector States">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Inspector states</div>
        <div className="muted" style={{ fontSize: 12 }}>Every right-rail panel must handle these states. Title-bar stays the same; the body switches.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, height: 760 }}>
        {[
          { t: 'Empty · no selection', body: <EmptyState /> },
          { t: 'Loading · streaming voxels', body: <LoadingState /> },
          { t: 'Multi-selection · 3 voxels', body: <MultiState /> },
          { t: 'Conflict · mixed values', body: <ConflictState /> },
          { t: 'Locked by area rule', body: <LockedState /> },
          { t: 'Locked by agent (acting)', body: <AgentLockState /> },
          { t: 'Validation error', body: <ErrorState /> },
          { t: 'Read-only · imported', body: <ReadOnlyState /> },
        ].map((s) => (
          <div key={s.t} className="panel">
            <div className="panel-tb">
              <Icons.Cube size={12} style={{ color: 'var(--fg-3)' }} />
              <span className="title" style={{ fontSize: 11 }}>{s.t}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <span className="kbd" style={{ fontSize: 9 }}>state</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{s.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="center" style={{ flexDirection: 'column', height: '100%', padding: 16, gap: 10, color: 'var(--fg-3)' }}>
      <div style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--bg-input)', border: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Cursor size={20} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>Nothing selected</div>
      <div style={{ fontSize: 10.5, textAlign: 'center', maxWidth: 220 }}>Click a voxel, area or water body in the viewport, or pick from the outliner.</div>
      <button className="btn sm agent"><Icons.Bot size={11} />Ask agent to suggest</button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="insp" style={{ padding: 0 }}>
      <div className="hint">streaming chunk [16,3,−4]…</div>
      <div className="insp-body">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="insp-row">
            <div className="lbl"><span style={{ display: 'inline-block', width: 60, height: 8, background: 'var(--bg-elev-2)', borderRadius: 2 }} /></div>
            <div className="val"><span style={{ display: 'inline-block', width: '100%', height: 14, background: 'linear-gradient(90deg, var(--bg-input), var(--bg-elev-2), var(--bg-input))', backgroundSize: '200% 100%', borderRadius: 2 }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiState() {
  return (
    <div className="insp">
      <InspSection title="3 voxels selected" right={<span className="tag cyan">MULTI</span>}>
        <Row label="World pos"><span className="muted" style={{ fontSize: 10.5 }}>—</span></Row>
        <Row label="Voxel type"><Sel value="Mixed" options={['Mixed','Grass Block','Stone']} /></Row>
        <Row label="Material idx"><span className="num" style={{ fontSize: 11, color: 'var(--warn)' }}>02 · 04 · 07</span></Row>
        <Row label="Top atlas"><span className="muted" style={{ fontSize: 11 }}>—</span></Row>
        <Row label="Breakable"><Toggle on={false} /></Row>
      </InspSection>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button className="btn">Unify</button>
        <button className="btn pri">Apply to All</button>
      </div>
    </div>
  );
}

function ConflictState() {
  return (
    <div className="insp">
      <div className="hint" style={{ color: 'var(--warn)', background: 'var(--warn-soft)', borderColor: 'rgba(245,165,36,0.3)' }}>
        <Icons.AlertTriangle size={11} /> Mixed values across selection — pick one to apply.
      </div>
      <InspSection title="Conflicts (4)">
        {[
          ['Voxel type', '3 unique', 'Grass Block · Stone · Sand'],
          ['Top atlas', '2 unique', 'tile_07 · tile_18'],
          ['Hardness', '2 unique', '0.6 · 1.2'],
          ['Breakable', 'mixed', 'on · off'],
        ].map(([k, n, v]) => (
          <div key={k} className="kv" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <span className="k">{k}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="tag warn" style={{ height: 14, fontSize: 9 }}>{n}</span>
              <span className="muted" style={{ fontSize: 10 }}>{v}</span>
            </span>
          </div>
        ))}
      </InspSection>
    </div>
  );
}

function LockedState() {
  return (
    <div className="insp">
      <div className="hint" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', borderColor: 'rgba(239,79,94,0.3)' }}>
        <Icons.Lock size={11} /> Locked by area rule · <span className="mono" style={{ fontSize: 10 }}>Ember Sanctum</span>
      </div>
      <InspSection title="Selected · Voxel" right={<span className="tag bad">LOCKED</span>}>
        <Row label="World pos"><Vec3 x="512.0" y="48.0" z="−128.0" /></Row>
        <Row label="Voxel type">
          <span className="row" style={{ gap: 4, opacity: 0.55 }}>
            <Icons.Lock size={11} /><span>Stone</span>
          </span>
        </Row>
        <Row label="Breakable">
          <span style={{ opacity: 0.45 }}><Toggle on={false} /></span>
        </Row>
      </InspSection>
      <div style={{ padding: 8, display: 'grid', gap: 4 }}>
        <button className="btn full danger sm">Unlock area first</button>
      </div>
    </div>
  );
}

function AgentLockState() {
  return (
    <div className="insp">
      <div className="hint agent">
        <Icons.Bot size={11} /> Agent is acting on this — Step 3/6 · <span className="kbd">Esc</span> to take over
      </div>
      <InspSection title="Selected · Voxel" right={<span className="tag agent"><Icons.Bot size={9} />acting</span>}>
        <Row label="Voxel type">
          <span className="row" style={{ width: '100%', gap: 6 }}>
            <span style={{ flex: 1, color: 'var(--agent-strong)' }}>Stone → Grass Block</span>
            <Icons.ArrowR size={11} style={{ color: 'var(--agent-strong)' }} />
          </span>
        </Row>
        <Row label="Top atlas">
          <span className="row" style={{ gap: 6 }}>
            <span className="num muted">tile_18</span><Icons.ArrowR size={10} /><span className="num" style={{ color: 'var(--agent-strong)' }}>tile_07</span>
          </span>
        </Row>
        <Row label="Approval">
          <button className="btn sm agent full">Approve change</button>
        </Row>
      </InspSection>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="insp">
      <div className="hint" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', borderColor: 'rgba(239,79,94,0.3)' }}>
        <Icons.AlertTriangle size={11} /> Failed to remesh — <span className="mono" style={{ fontSize: 10 }}>chunk [17,3,−4]</span>
      </div>
      <InspSection title="Selected · Chunk" right={<span className="tag bad">ERROR</span>}>
        <Row label="Status"><span className="tag bad" style={{ height: 14, fontSize: 9 }}>remesh failed</span></Row>
        <Row label="Reason"><span className="muted" style={{ fontSize: 10.5 }}>voxel out of bounds at (17, 64, −4)</span></Row>
        <Row label="Last ok"><span className="num muted" style={{ fontSize: 10 }}>14:30:18</span></Row>
      </InspSection>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button className="btn sm">Retry</button>
        <button className="btn sm pri">Open log</button>
      </div>
    </div>
  );
}

function ReadOnlyState() {
  return (
    <div className="insp">
      <div className="hint">
        <Icons.Lock size={11} /> Read-only · imported from <span className="mono" style={{ fontSize: 10 }}>shared/world.dvw</span>
      </div>
      <InspSection title="Selected · Region" right={<span className="tag" style={{ height: 14, fontSize: 9 }}>READ ONLY</span>}>
        <Row label="Name"><span style={{ opacity: 0.7 }}>North Coast</span></Row>
        <Row label="Origin"><span className="num muted" style={{ fontSize: 10.5 }}>shared/world.dvw#region:02</span></Row>
        <Row label="Last sync"><span className="num muted" style={{ fontSize: 10.5 }}>2m ago</span></Row>
      </InspSection>
      <div style={{ padding: 8 }}>
        <button className="btn sm full">Fork into local</button>
      </div>
    </div>
  );
}

// ── Screen 7: Screen states (canvas-level)
function ScreenScreenStates() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 24, overflow: 'auto' }} data-screen-label="07 Screen States">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>Screen states · viewport-level</div>
        <div className="muted" style={{ fontSize: 12 }}>How the editor frame behaves when there is no world, while loading, on error, when offline from the runtime, or while the agent has the wheel.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, height: 760 }}>
        <ScreenStateCard title="Empty · no world open" body={<EmptyWorld />} />
        <ScreenStateCard title="Loading · streaming chunks" body={<LoadingWorld />} />
        <ScreenStateCard title="Runtime disconnected" body={<DisconnectedWorld />} />
        <ScreenStateCard title="Agent has the wheel" body={<AgentDrivingWorld />} agent />
      </div>
    </div>
  );
}

function ScreenStateCard({ title, body, agent }) {
  return (
    <div className="panel">
      <div className="panel-tb">
        <Icons.Globe size={12} style={{ color: 'var(--fg-3)' }} />
        <span className="title">{title}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {agent && <span className="tag agent"><Icons.Bot size={9} />agent</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{body}</div>
    </div>
  );
}

function EmptyWorld() {
  return (
    <div className="vp center" style={{ flexDirection: 'column', height: 320, gap: 12 }}>
      <div style={{ width: 64, height: 64, position: 'relative' }}>
        <svg viewBox="0 0 64 64" width="64" height="64">
          <path d="M32 8 L56 22 L32 36 L8 22 Z" fill="none" stroke="#4ec5ff" strokeWidth="1.2" strokeDasharray="3 3" />
          <path d="M32 36 L56 22 L56 46 L32 60 Z" fill="none" stroke="#3a4252" strokeWidth="1.2" strokeDasharray="3 3" />
          <path d="M32 36 L8 22 L8 46 L32 60 Z" fill="none" stroke="#3a4252" strokeWidth="1.2" strokeDasharray="3 3" />
        </svg>
      </div>
      <div style={{ color: 'var(--fg)', fontSize: 13 }}>No world open</div>
      <div className="muted" style={{ fontSize: 11, textAlign: 'center', maxWidth: 320 }}>Open an existing <span className="mono">.dvw</span> world or generate a new procedural one.</div>
      <div className="row">
        <button className="btn"><Icons.Folder size={11} />Open World…</button>
        <button className="btn pri"><Icons.Plus size={11} />New World</button>
        <button className="btn agent"><Icons.Bot size={11} />Generate from prompt</button>
      </div>
    </div>
  );
}

function LoadingWorld() {
  return (
    <div className="vp" style={{ height: 320, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, rgba(78,197,255,0.04) 0 6px, transparent 6px 14px)' }} />
      <div className="center" style={{ height: '100%', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 14px)', gap: 2 }}>
          {Array.from({ length: 64 }).map((_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: 2,
              background: i < 38 ? 'var(--accent)' : 'var(--bg-elev-2)',
              opacity: i < 38 ? (0.4 + (i / 100)) : 0.5,
            }} />
          ))}
        </div>
        <div className="num" style={{ color: 'var(--accent-strong)', fontSize: 12 }}>Loading 38 / 64 chunks · 142 MB</div>
        <div className="muted" style={{ fontSize: 10.5 }}>Meshing terrain · baking GI probes · resolving water bodies</div>
      </div>
    </div>
  );
}

function DisconnectedWorld() {
  return (
    <div className="vp center" style={{ flexDirection: 'column', height: 320, gap: 10 }}>
      <Icons.AlertTriangle size={28} style={{ color: 'var(--bad)' }} />
      <div style={{ color: 'var(--fg)', fontSize: 13 }}>Runtime disconnected</div>
      <div className="muted mono" style={{ fontSize: 10.5 }}>bevy://localhost:9100  ·  last frame 14:31:24</div>
      <div className="row">
        <button className="btn"><Icons.Refresh size={11} />Reconnect</button>
        <button className="btn"><Icons.Terminal size={11} />Open log</button>
      </div>
      <div className="muted" style={{ fontSize: 10.5, maxWidth: 320, textAlign: 'center' }}>The editor stays usable in offline mode — voxel edits queue and replay on reconnect.</div>
    </div>
  );
}

function AgentDrivingWorld() {
  return (
    <div className="vp" style={{ height: 320, position: 'relative', overflow: 'hidden' }}>
      <VoxelScene variant="agent" overlays={{ grid: true, chunks: true }} />
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 2px var(--agent), inset 0 0 60px rgba(162,108,255,0.25)', pointerEvents: 'none', borderRadius: 3 }} />
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, padding: '6px 10px', background: 'rgba(34,20,50,0.92)', border: '1px solid rgba(162,108,255,0.45)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icons.Bot size={13} style={{ color: 'var(--agent-strong)' }} />
        <span style={{ fontSize: 11, color: 'var(--fg)' }}>Agent has the wheel — input disabled</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="tag agent">Step 3/6</span>
        <button className="btn sm">Take over <span className="kbd">Esc</span></button>
      </div>
    </div>
  );
}

// ── Screen 8: Agent Workbench redesign — Observe / Plan / Act / Verify lanes
function ScreenAgentRedesign() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 16, overflow: 'auto' }} data-screen-label="08 Agent Workbench Redesign">
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Agent Workbench · Observe → Plan → Act → Verify</div>
        <div className="muted" style={{ fontSize: 11 }}>Four lanes, every event auditable. The agent never modifies world state without explicit per-step approval (when policy = strict).</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1.1fr', gap: 8, height: 820 }}>
        <Lane title="Observe" tone="muted" caption="A11y snapshot · viewport screenshot · selection · constraints" body={<LaneObserve />} />
        <Lane title="Plan" tone="agent" caption="Stepwise plan · per-step approvals" body={<LanePlan />} />
        <Lane title="Act" tone="cyan" caption="Stable command IDs · args · diff" body={<LaneAct />} />
        <Lane title="Verify" tone="ok" caption="Assertions · visual diff · generated tests" body={<LaneVerify />} />
      </div>
    </div>
  );
}

function Lane({ title, caption, body, tone }) {
  const colorMap = { agent: 'var(--agent-strong)', cyan: 'var(--accent-strong)', ok: 'var(--ok)', muted: 'var(--fg-2)' };
  return (
    <div className="panel">
      <div className="panel-tb" style={{ background: 'linear-gradient(to bottom, #1c2026, #181b20)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: colorMap[tone], boxShadow: `0 0 6px ${colorMap[tone]}` }} />
        <span className="title" style={{ color: colorMap[tone] }}>{title}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 10 }}>{caption}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>{body}</div>
    </div>
  );
}

function LaneObserve() {
  return (
    <div style={{ padding: 10, fontSize: 11 }}>
      <div className="cap" style={{ marginBottom: 4 }}>Viewport snapshot</div>
      <div style={{ height: 110, background: '#0c1015', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <VoxelScene variant="agent" overlays={{ grid: true, chunks: true }} />
      </div>
      <div className="hr" />
      <div className="cap" style={{ marginBottom: 4 }}>A11y snapshot</div>
      <pre className="mono" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, padding: 6, fontSize: 9.5, color: 'var(--fg-2)', margin: 0, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{
`{
  tool: "area",
  selection: ["chunk:18,3,-4","chunk:19,3,-4","chunk:20,3,-4"],
  panel: "inspector",
  constraints: ["no-dig","no-build"],
  parents: ["story-locks"]
}`
      }</pre>
      <div className="hr" />
      <div className="cap" style={{ marginBottom: 4 }}>Why this matters</div>
      <div className="muted" style={{ fontSize: 10.5 }}>The agent reads the same DOM/testid grid that Playwright does. Whatever the agent can do, the test runner can replay.</div>
    </div>
  );
}

function LanePlan() {
  const steps = [
    { n: 'Inspect viewport selection', s: 'done' },
    { n: 'Identify intersecting chunks', s: 'done' },
    { n: 'Create unbreakable box', s: 'active' },
    { n: 'Set rules: deny mine + place', s: 'pending' },
    { n: 'Rebuild affected chunks', s: 'pending' },
    { n: 'Generate Playwright test', s: 'pending' },
  ];
  return (
    <div style={{ padding: 10 }}>
      <div className="agent-card" style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--fg)', marginBottom: 4 }}>Goal</div>
        <div style={{ fontSize: 12, color: 'var(--fg)' }}>Lock the Ember Sanctum so players can\u2019t destroy it.</div>
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <span className="tag agent">strict</span>
          <span className="tag">per-step</span>
          <span className="tag">claude · sonnet</span>
        </div>
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'center',
          padding: '6px 6px', borderBottom: '1px solid var(--border-soft)',
          background: s.s === 'active' ? 'var(--agent-soft)' : 'transparent',
          borderLeft: s.s === 'active' ? '2px solid var(--agent)' : '2px solid transparent',
        }}>
          <span style={{
            width: 18, height: 18, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: s.s === 'done' ? 'var(--ok-soft)' : s.s === 'active' ? 'var(--agent-soft)' : 'var(--bg-input)',
            color: s.s === 'done' ? 'var(--ok)' : s.s === 'active' ? 'var(--agent-strong)' : 'var(--fg-4)',
            border: `1px solid ${s.s === 'done' ? 'rgba(54,196,106,0.3)' : s.s === 'active' ? 'rgba(162,108,255,0.4)' : 'var(--border)'}`,
            fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 600,
          }}>{s.s === 'done' ? <Icons.Check size={10} sw={2.5} /> : i + 1}</span>
          <span style={{ fontSize: 11.5, color: s.s === 'pending' ? 'var(--fg-3)' : 'var(--fg)' }}>{s.n}</span>
          {s.s === 'active' ? <span className="tag agent" style={{ height: 14, fontSize: 9 }}>now</span> : s.s === 'done' ? <span className="muted" style={{ fontSize: 10 }}>2.1s</span> : <span className="muted" style={{ fontSize: 10 }}>—</span>}
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 10 }}>
        <button className="btn agent">Approve</button>
        <button className="btn">Revise</button>
        <button className="btn danger">Reject</button>
      </div>
    </div>
  );
}

function LaneAct() {
  const calls = [
    { t: '14:31:08', id: 'editor.area.createUnbreakableBox', args: '{ chunkSet:[18,19,20] }', ok: true },
    { t: '14:31:09', id: 'editor.area.setRule', args: '{ canMine:false, canPlace:false }', ok: true },
    { t: '14:31:10', id: 'editor.world.rebuildChunk', args: '{ id:"[18,3,-4]" }', ok: true },
    { t: '14:31:11', id: 'editor.world.rebuildChunk', args: '{ id:"[17,3,-4]" }', ok: false },
  ];
  return (
    <div style={{ padding: 10, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
      <div className="cap" style={{ marginBottom: 4 }}>Tool calls</div>
      {calls.map((c, i) => (
        <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 9.5 }}>{c.t}</span>
            <span style={{ color: c.ok ? 'var(--ok)' : 'var(--bad)', fontSize: 9.5 }}>{c.ok ? 'OK' : 'ERR'}</span>
          </div>
          <div style={{ color: 'var(--accent-strong)', fontSize: 11 }}>{c.id}</div>
          <div className="muted" style={{ fontSize: 10 }}>{c.args}</div>
        </div>
      ))}
      <div className="hr" />
      <div className="cap" style={{ marginBottom: 4 }}>Pending state diff</div>
      <pre style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, padding: 6, margin: 0, fontSize: 9.5, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{
`+ areas[Ember Sanctum] = unbreakable box
+   rules: { canMine:false, canPlace:false }
~ chunks[18,3,-4].dirty = true
~ chunks[19,3,-4].dirty = true
~ chunks[20,3,-4].dirty = true`
      }</pre>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" style={{ flex: 1 }}>Replay</button>
        <button className="btn sm danger" style={{ flex: 1 }}>Rollback</button>
      </div>
    </div>
  );
}

function LaneVerify() {
  return (
    <div style={{ padding: 10, fontSize: 11 }}>
      <div className="cap" style={{ marginBottom: 4 }}>Assertions</div>
      {[
        ['protected area exists', true],
        ['rules deny mine/place', true],
        ['visual diff < 2%', true],
        ['fps within 10% of baseline', false],
      ].map(([k, v]) => (
        <div key={k} className="row" style={{ padding: '3px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <span style={{ width: 14, color: v ? 'var(--ok)' : 'var(--bad)' }}>
            {v ? <Icons.CheckCircle size={12} /> : <Icons.AlertTriangle size={12} />}
          </span>
          <span style={{ flex: 1, color: 'var(--fg-2)' }}>{k}</span>
          <span className={`tag ${v ? 'ok' : 'bad'}`} style={{ height: 14, fontSize: 9 }}>{v ? 'pass' : 'fail'}</span>
        </div>
      ))}
      <div className="hr" />
      <div className="cap" style={{ marginBottom: 4 }}>Visual diff</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div style={{ height: 70, background: '#0c1015', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <svg viewBox="0 0 100 70" width="100%" height="100%"><rect width="100" height="40" fill="#1a2638"/><rect y="40" width="100" height="30" fill="#3e6e2c"/></svg>
        </div>
        <div style={{ height: 70, background: '#0c1015', border: '1px solid var(--ok)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
          <svg viewBox="0 0 100 70" width="100%" height="100%"><rect width="100" height="40" fill="#1a2638"/><rect y="40" width="100" height="30" fill="#3e6e2c"/><rect x="40" y="35" width="22" height="20" fill="rgba(239,79,94,0.25)" stroke="#ef4f5e" strokeWidth="0.6" /></svg>
          <span style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 9, color: 'var(--ok)' }}>1.2% diff</span>
        </div>
      </div>
      <div className="hr" />
      <div className="cap" style={{ marginBottom: 4 }}>Generated test</div>
      <div className="kv"><span className="k">File</span><span className="v" style={{ fontSize: 10 }}>tests/area-unbreakable.spec.ts</span></div>
      <div className="kv"><span className="k">Steps</span><span className="v">7</span></div>
      <div className="kv"><span className="k">Selectors</span><span className="v num">data-testid</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 8 }}>
        <button className="btn sm">Open in Code</button>
        <button className="btn sm pri">Approve & Run</button>
      </div>
    </div>
  );
}

// ── Screen 9: Dock layout / responsive spec
function ScreenDockSpec() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 24, overflow: 'auto' }} data-screen-label="09 Dockable Layout Spec">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>Dockable layout · responsive behavior</div>
        <div className="muted" style={{ fontSize: 12 }}>Panels are draggable. Three reference layouts target three viewport widths. Same DOM, same testids — the dock manager re-parents.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <DockLayout label="≥ 1600 · workstation" cols={['244','1fr','296']} rows={['1fr','232']} />
        <DockLayout label="1280–1599 · laptop" cols={['224','1fr','272']} rows={['1fr','200']} compact />
        <DockLayout label="< 1280 · review" cols={['200','1fr']} rows={['1fr','180']} narrow />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12 }}>
        <div className="panel">
          <div className="panel-tb"><span className="title">Drag-and-drop semantics</span></div>
          <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-2)' }}>
            <ul style={{ margin: 0, padding: '0 0 0 14px', lineHeight: 1.7 }}>
              <li>Drag panel tab → drop indicators on each region (top / bottom / left / right / center).</li>
              <li>Drop on center = stack as tab. Drop on edge = split that region.</li>
              <li>Detach by dragging tab outside any region → floating window with same chrome.</li>
              <li>Workspaces saved to <span className="mono">workspaces/&lt;name&gt;.json</span>; presets: <span className="mono">Default</span>, <span className="mono">Sculpt</span>, <span className="mono">Paint</span>, <span className="mono">Agent</span>, <span className="mono">Review</span>.</li>
              <li>Min panel size: 200×120. Below that, the region collapses to a tab strip.</li>
              <li>Splitter handles: 4px, hover expands to 6px, cursor flips to <span className="mono">col-resize</span>.</li>
              <li>Keyboard: <span className="kbd">⌘1</span>…<span className="kbd">⌘5</span> = workspace presets, <span className="kbd">⌘\</span> toggle right rail, <span className="kbd">⌘B</span> toggle bottom dock.</li>
            </ul>
          </div>
        </div>
        <div className="panel">
          <div className="panel-tb"><span className="title">Panel registry</span></div>
          <div style={{ padding: 0, fontSize: 11 }}>
            {[
              ['Outliner', 'panel-outliner', 'left', 'all'],
              ['Inspector', 'panel-inspector', 'right', 'all'],
              ['Brush', 'panel-brush', 'right', 'paint, sculpt'],
              ['Material', 'panel-material', 'right', 'paint'],
              ['Rules', 'panel-rules', 'right', 'area'],
              ['Assets', 'panel-assets', 'bottom', 'all'],
              ['Texture Atlas', 'panel-atlas', 'bottom', 'paint'],
              ['Console', 'panel-console', 'bottom', 'all'],
              ['Profiler', 'panel-profiler', 'bottom', 'debug'],
              ['Agent Log', 'panel-agentlog', 'bottom', 'agent'],
              ['Tests', 'panel-tests', 'bottom', 'agent'],
              ['Viewport', 'panel-viewport', 'center', 'all'],
              ['Agent Workbench', 'panel-agent', 'right (320)', 'agent'],
            ].map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.9fr 1fr', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--fg)' }}>{r[0]}</span>
                <span className="mono muted" style={{ fontSize: 10 }}>{r[1]}</span>
                <span className="muted">{r[2]}</span>
                <span className="muted" style={{ fontSize: 10 }}>{r[3]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DockLayout({ label, cols, rows, compact, narrow }) {
  const w = 420, h = 260;
  return (
    <div className="panel">
      <div className="panel-tb"><span className="title">{label}</span></div>
      <div style={{ padding: 10 }}>
        <div style={{
          width: w, height: h, display: 'grid',
          gridTemplateColumns: cols.map(c => c.endsWith('fr') ? c : `${parseInt(c) * 0.18}px`).join(' '),
          gridTemplateRows: rows.map(r => r === '1fr' ? '1fr' : `${parseInt(r) * 0.18}px`).join(' '),
          gap: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', borderRadius: 4, padding: 4,
        }}>
          <DockBox label="Outliner" testid="panel-outliner" rowSpan={2} />
          <DockBox label="Viewport" testid="panel-viewport" hero />
          {!narrow && <DockBox label="Inspector" testid="panel-inspector" rowSpan={2} />}
          <DockBox label={narrow ? 'Bottom dock' : 'Assets · Console · Profiler'} testid="panel-bottom" tabbed />
        </div>
        <div className="hr" />
        <div className="kv"><span className="k">Min width</span><span className="v">{narrow ? '960px' : compact ? '1280px' : '1600px'}</span></div>
        <div className="kv"><span className="k">Right rail</span><span className="v">{narrow ? 'collapses to tab strip' : 'always visible'}</span></div>
        <div className="kv"><span className="k">Bottom dock</span><span className="v">{narrow ? '180px (tabs)' : compact ? '200px' : '232px'}</span></div>
      </div>
    </div>
  );
}

function DockBox({ label, testid, hero, rowSpan, tabbed }) {
  return (
    <div style={{
      gridRow: rowSpan ? `1 / span ${rowSpan}` : undefined,
      background: hero ? 'linear-gradient(180deg, #1a2638 0%, #0f1620 100%)' : 'var(--bg-panel)',
      border: '1px solid var(--border)', borderRadius: 3,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '3px 6px', fontSize: 9.5, color: hero ? '#fff' : 'var(--fg-2)', borderBottom: '1px solid var(--border-soft)', background: hero ? 'rgba(0,0,0,0.4)' : 'transparent', display: 'flex', alignItems: 'center', gap: 4 }}>
        {tabbed && <span style={{ width: 4, height: 4, borderRadius: 2, background: 'var(--accent)' }} />}
        <span>{label}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="mono muted" style={{ fontSize: 8 }}>{testid}</span>
      </div>
      <div style={{ flex: 1, opacity: 0.5, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!hero && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 4, background: 'var(--bg-elev-2)', borderRadius: 1, width: `${90 - i * 8}%` }} />
        ))}
        {hero && (
          <div style={{ flex: 1, position: 'relative' }}>
            <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <ellipse cx="50" cy="36" rx="28" ry="14" fill="#3e6e2c" />
              <ellipse cx="60" cy="40" rx="14" ry="6" fill="#1f5d8c" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen 10: A11y / data-testid naming convention reference
function ScreenA11ySpec() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 24, overflow: 'auto' }} data-screen-label="10 A11y + Testid">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>Accessibility & data-testid conventions</div>
        <div className="muted" style={{ fontSize: 12 }}>Stable selectors are not optional — both Playwright and the agent steer the editor through this grid.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
        <div className="panel">
          <div className="panel-tb"><span className="title">Naming pattern</span></div>
          <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-2)' }}>
            <pre className="mono" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, padding: 12, fontSize: 11, color: 'var(--fg)', margin: 0 }}>{`<role>-<entity>[-<id>]
└─ role        panel | tool | menu | tab | row | btn | input | dialog
└─ entity      kebab-case domain noun (outliner, brush, area, voxel)
└─ id          stable id where needed (chunk-16-3-4, atlas-tile-07)`}</pre>
            <div className="hr" />
            <div className="cap" style={{ marginBottom: 6 }}>Examples</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '4px 12px', fontSize: 11 }}>
              {[
                ['panel-viewport', 'the 3D canvas region'],
                ['panel-inspector', 'right-rail inspector container'],
                ['tool-paint', 'toolbar Paint mode'],
                ['vp-tool-area', 'in-viewport Area tool'],
                ['tab-rules', 'inspector Rules tab'],
                ['tree-item-chunk-16-3-4', 'an outliner row'],
                ['atlas-tile-07', 'one tile in the atlas grid'],
                ['vec3-position-x', 'numeric input, X axis of position'],
                ['btn-approve-step', 'agent step approval'],
                ['cmdk-item-editor.area.createUnbreakableBox', 'a palette result'],
                ['dialog-confirm-rebuild', 'a modal'],
              ].map((r, i) => (
                <React.Fragment key={i}>
                  <span className="mono" style={{ color: 'var(--accent-strong)' }}>{r[0]}</span>
                  <span className="muted">{r[1]}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-tb"><span className="title">ARIA roles & labels</span></div>
          <div style={{ padding: 14, fontSize: 11.5 }}>
            {[
              ['Editor frame', 'application', 'lang=en, role="application"'],
              ['Menubar', 'menubar', 'aria-label="Editor menu"'],
              ['Toolbar', 'toolbar', 'aria-label="Main toolbar"'],
              ['Tool group', 'radiogroup', 'aria-label="Active tool", radio per tool'],
              ['Outliner', 'tree', 'aria-label="World outliner", aria-expanded'],
              ['Tree row', 'treeitem', 'aria-level, aria-selected, aria-expanded'],
              ['Inspector', 'region', 'aria-label="Inspector"'],
              ['Inspector section', 'group', 'aria-labelledby on header h-id'],
              ['Vec3 field', 'group', '3 inputs, aria-label="X / Y / Z"'],
              ['Slider', 'slider', 'aria-valuemin/max/now, key arrows'],
              ['Toggle', 'switch', 'aria-checked, name = property'],
              ['Tabs', 'tablist + tab + tabpanel', 'arrow nav, home/end'],
              ['Command palette', 'dialog', 'aria-modal=true, focus trap'],
              ['Cmd palette list', 'listbox + option', 'aria-activedescendant'],
              ['Status bar', 'status', 'aria-live="polite" for build/fps'],
              ['Agent banner', 'alert', 'aria-live="assertive" on takeover'],
              ['Splitter', 'separator', 'aria-orientation, aria-valuenow'],
            ].map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--fg)' }}>{r[0]}</span>
                <span className="mono" style={{ color: 'var(--accent-strong)', fontSize: 10.5 }}>{r[1]}</span>
                <span className="muted" style={{ fontSize: 10.5 }}>{r[2]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-tb"><span className="title">Color contrast & focus</span></div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { l: 'fg on bg-app', a: '#e6e8ec', b: '#0d0f12', r: '15.3 : 1', t: 'AAA' },
              { l: 'fg-2 on bg-panel', a: '#b3b8c2', b: '#181b20', r: '9.8 : 1', t: 'AAA' },
              { l: 'fg-3 on bg-panel', a: '#7e8591', b: '#181b20', r: '4.7 : 1', t: 'AA · large' },
              { l: 'accent on bg-input', a: '#4ec5ff', b: '#14161a', r: '8.5 : 1', t: 'AAA' },
            ].map((c) => (
              <div key={c.l} style={{ background: c.b, border: '1px solid var(--border)', borderRadius: 4, padding: 10 }}>
                <div style={{ color: c.a, fontSize: 13, marginBottom: 6 }}>{c.l}</div>
                <div className="muted mono" style={{ fontSize: 10 }}>{c.a} on {c.b}</div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <span className="num" style={{ color: c.a }}>{c.r}</span>
                  <span className="tag ok" style={{ height: 14, fontSize: 9 }}>{c.t}</span>
                </div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 14, padding: 10, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-panel)' }}>
              <span className="cap">Focus ring</span>
              <button className="btn pri" style={{ outline: '2px solid var(--accent)', outlineOffset: 2 }}>Focused primary</button>
              <button className="btn" style={{ outline: '2px solid var(--accent)', outlineOffset: 2 }}>Focused default</button>
              <span className="ibtn active" style={{ outline: '2px solid var(--accent)', outlineOffset: 2 }}><Icons.Cube size={13} /></span>
              <span className="muted" style={{ fontSize: 11 }}>2px solid <span className="mono">var(--accent)</span> with 2px offset · never removed.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screen 11: Refined design tokens (elevation, motion, z-index, spacing rhythm)
function ScreenTokensRefined() {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, padding: 24, overflow: 'auto' }} data-screen-label="11 Tokens · Elevation & Motion">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Refined design tokens</div>
        <div className="muted" style={{ fontSize: 12 }}>Elevation, spacing rhythm, motion, z-index, panel hierarchy.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="panel">
          <div className="panel-tb"><span className="title">Surface elevation · 0–4</span></div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              ['app', '#0d0f12', 'shell'],
              ['canvas', '#101215', 'workspace'],
              ['panel', '#181b20', 'docked panel'],
              ['elev', '#20242b', 'menus, popovers'],
              ['elev-2', '#262a32', 'modals, palette'],
            ].map(([n, v, d], i) => (
              <div key={n} style={{ background: v, border: '1px solid var(--border)', borderRadius: 4, padding: 12, height: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: i >= 3 ? `var(--shadow-${i - 1})` : 'none' }}>
                <div className="num" style={{ color: 'var(--fg)', fontSize: 11 }}>z={i}</div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--fg)' }}>{n}</div>
                  <div className="muted mono" style={{ fontSize: 9.5 }}>{v}</div>
                  <div className="muted" style={{ fontSize: 10 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-tb"><span className="title">Spacing rhythm · 2/4/6/8/12/16/24</span></div>
          <div style={{ padding: 16 }}>
            {[2,4,6,8,12,16,24].map((s) => (
              <div key={s} className="row" style={{ marginBottom: 6, gap: 12 }}>
                <span className="num muted" style={{ width: 30, fontSize: 10 }}>{s}px</span>
                <div style={{ height: 12, background: 'var(--accent)', width: s * 8, borderRadius: 2, opacity: 0.5 + (s / 60) }} />
                <span className="muted" style={{ fontSize: 10 }}>--s-{[2,4,6,8,12,16,24].indexOf(s) + 1}</span>
              </div>
            ))}
            <div className="hr" />
            <div className="kv"><span className="k">Inspector row height</span><span className="v">22px</span></div>
            <div className="kv"><span className="k">Tree row height</span><span className="v">22px</span></div>
            <div className="kv"><span className="k">Toolbar height</span><span className="v">36px</span></div>
            <div className="kv"><span className="k">Panel titlebar</span><span className="v">28px</span></div>
            <div className="kv"><span className="k">Statusbar</span><span className="v">22px</span></div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-tb"><span className="title">Motion</span></div>
          <div style={{ padding: 16, fontSize: 11.5 }}>
            <div className="cap" style={{ marginBottom: 6 }}>Durations</div>
            <div className="kv"><span className="k">instant</span><span className="v">0ms · selection feedback</span></div>
            <div className="kv"><span className="k">fast</span><span className="v">120ms · hovers, toggles</span></div>
            <div className="kv"><span className="k">base</span><span className="v">180ms · panel show/hide</span></div>
            <div className="kv"><span className="k">slow</span><span className="v">280ms · workspace switch</span></div>
            <div className="hr" />
            <div className="cap" style={{ marginBottom: 6 }}>Easing</div>
            <div className="kv"><span className="k">standard</span><span className="v mono">cubic-bezier(.2,.8,.2,1)</span></div>
            <div className="kv"><span className="k">decel</span><span className="v mono">cubic-bezier(0,0,.2,1)</span></div>
            <div className="kv"><span className="k">accel</span><span className="v mono">cubic-bezier(.4,0,1,1)</span></div>
            <div className="hr" />
            <div className="cap" style={{ marginBottom: 6 }}>Reduce motion</div>
            <div className="muted" style={{ fontSize: 11 }}>Respect <span className="mono">prefers-reduced-motion</span>: collapse all panel transitions to 0ms; keep only opacity fades ≤80ms.</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-tb"><span className="title">Z-index layers</span></div>
          <div style={{ padding: 16, fontSize: 11.5 }}>
            {[
              ['1', 'viewport gizmos / overlays'],
              ['10', 'panel chrome, splitters'],
              ['20', 'menubar dropdowns'],
              ['30', 'context menus'],
              ['40', 'floating panels (detached)'],
              ['50', 'command palette'],
              ['60', 'modal dialogs'],
              ['70', 'toasts'],
              ['80', 'agent takeover banner'],
              ['90', 'app loader / splash'],
            ].map((r) => (
              <div key={r[0]} className="kv" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span className="num" style={{ width: 32 }}>{r[0]}</span>
                <span className="muted">{r[1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.CommandPaletteRefined = CommandPaletteRefined;
window.ScreenInspectorStates = ScreenInspectorStates;
window.ScreenScreenStates = ScreenScreenStates;
window.ScreenAgentRedesign = ScreenAgentRedesign;
window.ScreenDockSpec = ScreenDockSpec;
window.ScreenA11ySpec = ScreenA11ySpec;
window.ScreenTokensRefined = ScreenTokensRefined;
