// Inspector content for various selection types
const { useState: iUseState } = React;

// ── Inspector for selected voxel
function InspectorVoxel() {
  return (
    <div className="insp">
      <InspSection title="Selected · Voxel" right={<span className="tag cyan">VOXEL</span>}>
        <Row label="World pos"><Vec3 x="512.0" y="48.0" z="−128.0" /></Row>
        <Row label="Chunk pos"><Vec3 x="16" y="3" z="−4" /></Row>
        <Row label="Voxel type"><Sel value="Grass Block" options={['Grass Block','Dirt','Stone','Sand','Snow','Water','Wood','Leaves']} /></Row>
        <Row label="Material idx"><input className="num-input" defaultValue="04" /></Row>
        <Row label="Top atlas"><div className="row" style={{ width: '100%' }}><div className="swatch" style={{ background: '#5a8c3a' }} /><span className="num" style={{ fontSize: 11 }}>tile_07</span><span className="muted">Grass Top</span></div></Row>
        <Row label="Side atlas"><div className="row" style={{ width: '100%' }}><div className="swatch" style={{ background: '#8a5a3a' }} /><span className="num" style={{ fontSize: 11 }}>tile_18</span><span className="muted">Dirt Side</span></div></Row>
        <Row label="Bottom atlas"><div className="row" style={{ width: '100%' }}><div className="swatch" style={{ background: '#5e3d27' }} /><span className="num" style={{ fontSize: 11 }}>tile_18</span></div></Row>
        <Row label="Breakable"><Toggle on /></Row>
        <Row label="Light / AO"><span className="num" style={{ fontSize: 11 }}>L:14 AO:0.82</span></Row>
      </InspSection>
      <InspSection title="Area rule overrides" defaultOpen={false}>
        <Row label="No-dig"><Chk on={false} label="" /></Row>
        <Row label="No-build"><Chk on={false} label="" /></Row>
        <Row label="Quest lock"><Chk on={false} label="" /></Row>
      </InspSection>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button className="btn">Replace</button>
        <button className="btn">Paint</button>
        <button className="btn">Select Similar</button>
        <button className="btn pri">Rebuild Chunk</button>
      </div>
    </div>
  );
}

// ── Inspector for protected area
function InspectorArea() {
  const rules = [
    ['Can Mine', false], ['Can Place', false], ['Can Paint', false],
    ['Can Spawn Props', true], ['Can Water Edit', false], ['Can Save Modify', false],
  ];
  return (
    <div className="insp">
      <InspSection title="Selected · Protected Area" right={<span className="tag bad">UNBREAKABLE</span>}>
        <Row label="Name"><input className="text-input" defaultValue="Story Lock — Ember Sanctum" /></Row>
        <Row label="Type"><Sel value="Unbreakable" options={['Unbreakable','No-Dig','No-Build','No-Prop','Quest Lock','Spawn Protection']} /></Row>
        <Row label="Shape"><Sel value="Box" options={['Box','Sphere','Cylinder','Polygon','Chunk Set']} /></Row>
        <Row label="Min"><Vec3 x="448" y="32" z="−192" /></Row>
        <Row label="Max"><Vec3 x="608" y="96" z="−32" /></Row>
        <Row label="Priority"><div className="row" style={{ width: '100%' }}><Slider value={0.7} fmt={(v)=>Math.round(v*10)} /></div></Row>
        <Row label="Color"><div className="row"><div className="swatch" style={{ background: 'var(--bad)' }} /><span className="num muted" style={{ fontSize: 11 }}>#ef4f5e</span></div></Row>
        <Row label="Lock state"><div className="row"><Icons.Lock size={11} style={{ color: 'var(--bad)' }} /><span className="muted">locked by quest</span></div></Row>
      </InspSection>
      <InspSection title="Rule matrix">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 8px', fontSize: 11 }}>
          <div className="cap" style={{ gridColumn: '1 / -1', marginBottom: 2 }}>Permissions</div>
          {rules.map(([k, v]) => (
            <React.Fragment key={k}>
              <div style={{ color: 'var(--fg-2)' }}>{k}</div>
              <Chk on={v} />
              <span className="num" style={{ color: v ? 'var(--ok)' : 'var(--bad)', fontSize: 10 }}>{v ? 'ALLOW' : 'DENY'}</span>
            </React.Fragment>
          ))}
        </div>
      </InspSection>
      <InspSection title="Audit log" defaultOpen={false}>
        <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
          <div>14:31  agent  · created box from chunks 18,19,20</div>
          <div>14:33  user   · renamed → Ember Sanctum</div>
          <div>14:34  agent  · set rule Can Mine = DENY</div>
        </div>
      </InspSection>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button className="btn">Duplicate</button>
        <button className="btn danger">Delete</button>
      </div>
    </div>
  );
}

// ── Inspector for water body
function InspectorWater() {
  return (
    <div className="insp">
      <InspSection title="Selected · Water Body" right={<span className="tag cyan">LAKE</span>}>
        <Row label="Name"><input className="text-input" defaultValue="Lake LK_03 — Mirror Pond" /></Row>
        <Row label="Kind"><Sel value="Lake" options={['Ocean','Lake','River','Pond']} /></Row>
        <Row label="Center"><Vec3 x="384" y="14" z="−240" /></Row>
        <Row label="Radius"><div className="row" style={{ width: '100%' }}><Slider value={0.45} fmt={(v)=>Math.round(v*180)+' m'} /></div></Row>
      </InspSection>
      <InspSection title="Waves">
        <Row label="Amplitude"><Slider value={0.32} fmt={(v)=>v.toFixed(2)+' m'} /></Row>
        <Row label="Speed"><Slider value={0.55} /></Row>
        <Row label="Scale"><Slider value={0.7} /></Row>
        <Row label="Wave count"><input className="num-input" defaultValue="4" /></Row>
        <Row label="Displacement"><Toggle on /></Row>
      </InspSection>
      <InspSection title="Reflection / Fresnel">
        <Row label="Strength"><Slider value={0.85} /></Row>
        <Row label="Fresnel pow"><Slider value={0.5} fmt={(v)=>(v*8).toFixed(1)} /></Row>
        <Row label="Distortion"><Slider value={0.18} /></Row>
        <Row label="Clarity"><Slider value={0.62} /></Row>
        <Row label="Murkiness"><Slider value={0.25} /></Row>
      </InspSection>
      <InspSection title="Foam">
        <Row label="Enabled"><Toggle on /></Row>
        <Row label="Shore foam"><Slider value={0.6} /></Row>
        <Row label="Crest foam"><Slider value={0.35} /></Row>
      </InspSection>
      <InspSection title="Color">
        <Row label="Shallow"><div className="row"><div className="swatch" style={{ background: '#3a85b8' }} /><span className="num muted" style={{ fontSize: 11 }}>#3a85b8</span></div></Row>
        <Row label="Deep"><div className="row"><div className="swatch" style={{ background: '#0e2f4a' }} /><span className="num muted" style={{ fontSize: 11 }}>#0e2f4a</span></div></Row>
      </InspSection>
      <InspSection title="Debug">
        <Row label="Mode"><Sel value="Off" options={['Off','Mask','Reflection Only','Blend Factor']} /></Row>
        <Row label="Visual probe"><button className="btn sm full"><Icons.Beaker size={11} />Run Probe</button></Row>
      </InspSection>
    </div>
  );
}

// ── Bottom dock content (asset browser + console + profiler)
function AssetBrowser() {
  const cats = [
    { I: Icons.Cube, n: 'Voxel Blocks', c: 64 },
    { I: Icons.Layers, n: 'Terrain Materials', c: 18 },
    { I: Icons.Tree, n: 'Props', c: 142 },
    { I: Icons.Build, n: 'Buildings', c: 24 },
    { I: Icons.Water, n: 'Water', c: 8 },
    { I: Icons.Sparkle, n: 'Shaders', c: 36 },
    { I: Icons.File, n: 'Configs', c: 12 },
    { I: Icons.Save, n: 'Saves', c: 9 },
  ];
  const items = [
    { id: 'block_grass', n: 'Grass Block', c1: '#5a8c3a', c2: '#8a5a3a' },
    { id: 'block_dirt', n: 'Dirt', c1: '#8a5a3a', c2: '#5e3d27' },
    { id: 'block_stone', n: 'Stone', c1: '#7a7e85', c2: '#52565d' },
    { id: 'block_sand', n: 'Sand', c1: '#d8c389', c2: '#a89465' },
    { id: 'block_snow', n: 'Snow', c1: '#e6ecf2', c2: '#bcc4cd' },
    { id: 'block_log', n: 'Oak Log', c1: '#5a3a22', c2: '#3a2a18' },
    { id: 'block_leaves', n: 'Leaves', c1: '#3e6e2c', c2: '#284a1c' },
    { id: 'block_water', n: 'Water', c1: '#3a85b8', c2: '#0e2f4a' },
    { id: 'block_lava', n: 'Lava', c1: '#e85e2a', c2: '#8a2010' },
    { id: 'block_planks', n: 'Planks', c1: '#a87a4c', c2: '#7a5430' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 200px', height: '100%', minHeight: 0 }}>
      {/* Categories */}
      <div style={{ borderRight: '1px solid var(--border-soft)', overflow: 'auto' }}>
        <div className="tree-search">
          <Icons.Search size={11} />
          <input placeholder="Search assets" />
        </div>
        <div className="tree">
          {cats.map((c, i) => (
            <div key={c.n} className={`tree-row ${i === 0 ? 'selected' : ''}`} style={{ paddingLeft: 8 }}>
              <span className="ico"><c.I size={12} /></span>
              <span className="name">{c.n}</span>
              <span className="meta">{c.c}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Grid */}
      <div style={{ overflow: 'auto', padding: 6 }}>
        <div className="row" style={{ marginBottom: 6, gap: 4 }}>
          <span className="cap">Voxel Blocks · 64</span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="tag">grass</span>
          <span className="tag">terrain</span>
          <span className="ddn"><Icons.Filter size={10} /> Filter</span>
          <span className="ddn">Sort: A→Z</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
          {items.map((a, i) => (
            <div key={a.id} className={`asset-card ${i === 0 ? 'sel' : ''}`} data-testid={`asset-${a.id}`}>
              <div className="thumb" style={{ background: `linear-gradient(180deg, ${a.c1}, ${a.c2})`, position: 'relative' }}>
                <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                  <path d="M50 10 L90 30 L50 50 L10 30 Z" fill={a.c1} stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
                  <path d="M50 50 L90 30 L90 70 L50 90 Z" fill={a.c2} stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
                  <path d="M50 50 L10 30 L10 70 L50 90 Z" fill={a.c2} stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" opacity="0.7" />
                </svg>
              </div>
              <div className="meta"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.n}</span><span className="id">#{i.toString().padStart(2,'0')}</span></div>
            </div>
          ))}
        </div>
      </div>
      {/* Metadata */}
      <div style={{ borderLeft: '1px solid var(--border-soft)', padding: 8, overflow: 'auto', fontSize: 11 }}>
        <div style={{ width: '100%', aspectRatio: '1/1', background: 'linear-gradient(180deg, #5a8c3a, #5e3d27)', borderRadius: 3, marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
          <svg viewBox="0 0 100 100" width="100%" height="100%">
            <path d="M50 15 L88 33 L50 51 L12 33 Z" fill="#5a8c3a" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
            <path d="M50 51 L88 33 L88 73 L50 91 Z" fill="#8a5a3a" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
            <path d="M50 51 L12 33 L12 73 L50 91 Z" fill="#5e3d27" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
          </svg>
        </div>
        <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Grass Block</div>
        <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>blocks/grass.yaml · 2.4 KB</div>
        <div className="hr" />
        <div className="kv"><span className="k">ID</span><span className="v">block_grass</span></div>
        <div className="kv"><span className="k">Atlas top</span><span className="v">tile_07</span></div>
        <div className="kv"><span className="k">Atlas side</span><span className="v">tile_18</span></div>
        <div className="kv"><span className="k">Hardness</span><span className="v">0.6</span></div>
        <div className="kv"><span className="k">Tags</span><span className="v">grass terrain</span></div>
        <div className="hr" />
        <button className="btn full sm" style={{ marginBottom: 4 }}>Place in Viewport</button>
        <button className="btn full sm">Open in Material Editor</button>
      </div>
    </div>
  );
}

const CONSOLE_ROWS = [
  { ts: '14:30:12', src: 'world',    lvl: 'info', msg: 'World loaded · 1218 chunks · seed 0x4ab21' },
  { ts: '14:30:14', src: 'render',   lvl: 'info', msg: 'Frame budget set · target 8.3ms (120fps)' },
  { ts: '14:30:18', src: 'water',    lvl: 'ok',   msg: 'Reflection cam attached to Lake LK_03' },
  { ts: '14:30:22', src: 'props',    lvl: 'info', msg: 'Tree LOD bake complete · 2.1k instances' },
  { ts: '14:31:01', src: 'agent',    lvl: 'agent',msg: 'plan: 6 steps drafted for "create unbreakable area"' },
  { ts: '14:31:04', src: 'world',    lvl: 'warn', msg: 'Chunk [16,3,−4] dirty — pending remesh' },
  { ts: '14:31:10', src: 'render',   lvl: 'warn', msg: 'Shadow budget at 92% — consider lowering cascade 3' },
  { ts: '14:31:18', src: 'agent',    lvl: 'ok',   msg: 'verify: assertion 3/4 passed (visual diff < 1.2%)' },
  { ts: '14:31:24', src: 'world',    lvl: 'err',  msg: 'Failed to remesh chunk [17,3,−4]: voxel out of bounds' },
];

function ConsolePanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="tree-search">
        <Icons.Search size={11} /><input placeholder="Filter logs (rendering, world, props, water, agent, errors)" />
        <div style={{ display: 'flex', gap: 3 }}>
          <span className="tag">render</span>
          <span className="tag">world</span>
          <span className="tag agent">agent</span>
          <span className="tag bad">errors</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '2px 0' }}>
        {CONSOLE_ROWS.map((r, i) => (
          <div key={i} className="con-row">
            <span className="ts">{r.ts}</span>
            <span className={`lvl ${r.lvl}`}>{r.lvl}</span>
            <span className="src">{r.src}</span>
            <span>{r.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfilerPanel() {
  // Generate sparkline points
  const pts = Array.from({ length: 80 }).map((_, i) => 8 + Math.sin(i * 0.4) * 1.2 + (Math.random() - 0.5) * 1.5);
  const path = pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1)) * 100},${28 - (y - 5) * 3}`).join(' ');
  const rows = [
    ['Mesh — Voxel terrain', '2.81 ms', 'ok'],
    ['Mesh — Props (instanced)', '1.42 ms', 'ok'],
    ['Water — Reflection pass', '1.12 ms', 'warn'],
    ['Shadow — Cascade 0..3', '1.84 ms', 'warn'],
    ['GI — Probe relight', '0.62 ms', 'ok'],
    ['Post — Fog + AA', '0.44 ms', 'ok'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 220px', height: '100%', gap: 0 }}>
      <div style={{ padding: 10, borderRight: '1px solid var(--border-soft)' }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="cap">Frame time · 7.0 ms</span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="num muted" style={{ fontSize: 10 }}>target 8.3</span>
        </div>
        <div className="spark" style={{ height: 60 }}>
          <svg viewBox="0 0 100 28" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <line x1="0" y1="14" x2="100" y2="14" stroke="rgba(78,197,255,0.15)" strokeWidth="0.4" strokeDasharray="1 1" />
            <path d={path + ' L100,28 L0,28 Z'} fill="rgba(78,197,255,0.1)" />
            <path d={path} fill="none" stroke="#4ec5ff" strokeWidth="0.8" />
          </svg>
        </div>
        <div className="hr" />
        <div className="kv"><span className="k">Draw calls</span><span className="v">412</span></div>
        <div className="kv"><span className="k">Triangles</span><span className="v">1.84M</span></div>
        <div className="kv"><span className="k">VRAM</span><span className="v">684 MB</span></div>
        <div className="kv"><span className="k">Chunks meshed</span><span className="v">3 / s</span></div>
      </div>
      <div style={{ overflow: 'auto', padding: 10 }}>
        <div className="cap" style={{ marginBottom: 6 }}>Render timings</div>
        {rows.map(([n, t, s]) => (
          <div key={n} className="kv">
            <span className="k">{n}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="v">{t}</span>
              <span className={`pill ${s}`} style={{ height: 14, padding: '0 5px', fontSize: 9 }}><span className="dot" />{s}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding: 10, borderLeft: '1px solid var(--border-soft)' }}>
        <div className="cap" style={{ marginBottom: 6 }}>Budgets</div>
        <div className="kv"><span className="k">Prop instances</span><span className="v">4231 / 8000</span></div>
        <div className="kv"><span className="k">Shadow budget</span><span className="v" style={{ color: 'var(--warn)' }}>92%</span></div>
        <div className="kv"><span className="k">Water reflect</span><span className="v" style={{ color: 'var(--ok)' }}>active</span></div>
        <div className="kv"><span className="k">GI / AO</span><span className="v" style={{ color: 'var(--ok)' }}>baked</span></div>
        <div className="hr" />
        <button className="btn full sm">Open Full Profiler</button>
      </div>
    </div>
  );
}

function BottomDock({ defaultTab = 'assets' }) {
  const [tab, setTab] = iUseState(defaultTab);
  return (
    <Panel
      tabs={[
        { id: 'assets', label: 'Assets', badge: 313 },
        { id: 'atlas', label: 'Texture Atlas' },
        { id: 'console', label: 'Console', badge: 9 },
        { id: 'profiler', label: 'Profiler' },
        { id: 'agentlog', label: 'Agent Log', badge: 4 },
        { id: 'tests', label: 'Tests' },
      ]}
      activeTab={tab}
      onTab={setTab}
      testid="panel-bottom"
    >
      {tab === 'assets' && <AssetBrowser />}
      {tab === 'atlas' && <div style={{ padding: 12, color: 'var(--fg-3)' }}>Texture Atlas editor — see screen 3.</div>}
      {tab === 'console' && <ConsolePanel />}
      {tab === 'profiler' && <ProfilerPanel />}
      {tab === 'agentlog' && <AgentLog />}
      {tab === 'tests' && <TestsPanel />}
    </Panel>
  );
}

function AgentLog() {
  const events = [
    { phase: 'Observe', t: '14:30:58', msg: 'Captured viewport · selection: chunk [16,3,−4]', col: 'var(--fg-3)' },
    { phase: 'Plan', t: '14:31:01', msg: 'Drafted 6 steps · target: create unbreakable area from chunks 18,19,20', col: 'var(--agent-strong)' },
    { phase: 'Act',  t: '14:31:08', msg: 'Invoked editor.area.createUnbreakableBox · args: chunkSet=[18,19,20]', col: 'var(--accent-strong)' },
    { phase: 'Act',  t: '14:31:09', msg: 'Invoked editor.area.setRule · {canMine:false, canPlace:false}', col: 'var(--accent-strong)' },
    { phase: 'Verify', t: '14:31:18', msg: 'Assertion: 3/4 passed · visual diff 1.2%', col: 'var(--ok)' },
    { phase: 'Verify', t: '14:31:19', msg: 'Generated Playwright test: tests/area-unbreakable.spec.ts', col: 'var(--ok)' },
  ];
  return (
    <div style={{ padding: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 56px 1fr', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <span style={{ color: e.col, fontWeight: 600 }}>{e.phase}</span>
          <span style={{ color: 'var(--fg-4)' }}>{e.t}</span>
          <span style={{ color: 'var(--fg-2)' }}>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

function TestsPanel() {
  const tests = [
    { n: 'area-unbreakable.spec.ts', s: 'pass', t: '1.4s' },
    { n: 'voxel-paint-atlas.spec.ts', s: 'pass', t: '0.9s' },
    { n: 'water-reflection.spec.ts', s: 'fail', t: '2.1s', err: 'Visual diff 4.8% > 2% threshold' },
    { n: 'chunk-rebuild.spec.ts', s: 'pass', t: '0.6s' },
    { n: 'prop-scatter-density.spec.ts', s: 'pending', t: '—' },
  ];
  return (
    <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11 }}>
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="cap">Playwright Runs</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm"><Icons.Play size={10} /> Run All</button>
          <button className="btn sm agent"><Icons.Bot size={10} /> Generate</button>
        </div>
        {tests.map((t) => (
          <div key={t.n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderBottom: '1px solid var(--border-soft)' }}>
            <span className={`pill ${t.s === 'pass' ? 'ok' : t.s === 'fail' ? 'bad' : 'warn'}`} style={{ height: 16, padding: '0 5px', fontSize: 9 }}><span className="dot" />{t.s}</span>
            <span className="mono" style={{ fontSize: 10.5, flex: 1 }}>{t.n}</span>
            <span className="muted num" style={{ fontSize: 10 }}>{t.t}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="cap" style={{ marginBottom: 6 }}>Before / After · water-reflection</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div style={{ background: '#0c1015', height: 80, border: '1px solid var(--border)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
            <svg viewBox="0 0 100 80" width="100%" height="100%"><rect width="100" height="40" fill="#1a2638"/><rect y="40" width="100" height="40" fill="#1f5d8c"/><circle cx="80" cy="20" r="6" fill="#ffd28a" opacity="0.5"/></svg>
            <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 9, color: 'var(--fg-3)' }}>before</span>
          </div>
          <div style={{ background: '#0c1015', height: 80, border: '1px solid var(--bad)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
            <svg viewBox="0 0 100 80" width="100%" height="100%"><rect width="100" height="40" fill="#1a2638"/><rect y="40" width="100" height="40" fill="#3a85b8"/><circle cx="80" cy="20" r="6" fill="#ffd28a"/></svg>
            <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 9, color: 'var(--bad)' }}>after · diff 4.8%</span>
          </div>
        </div>
        <div className="hr" />
        <div className="cap" style={{ marginBottom: 4 }}>UI scenario checklist</div>
        {[
          ['Open World file', true], ['Select chunk in outliner', true],
          ['Toggle chunk bounds', true], ['Reflection probe stable', false],
        ].map(([k,v]) => (
          <div key={k} className="row" style={{ padding: '2px 0' }}>
            <Chk on={v} /><span style={{ color: 'var(--fg-2)' }}>{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

window.InspectorVoxel = InspectorVoxel;
window.InspectorArea = InspectorArea;
window.InspectorWater = InspectorWater;
window.AssetBrowser = AssetBrowser;
window.ConsolePanel = ConsolePanel;
window.ProfilerPanel = ProfilerPanel;
window.BottomDock = BottomDock;
window.AgentLog = AgentLog;
window.TestsPanel = TestsPanel;
