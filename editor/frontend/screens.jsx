// Screen frames — each represents one full editor mockup at 1440x900

function ScreenFrame({ children, label, agent, showCmdK }) {
  return (
    <div className="editor-root" style={{ width: 1440, height: 900, position: 'relative' }} data-screen-label={label}>
      <div className="ed-frame">
        {children}
      </div>
      {showCmdK && <CommandPalette />}
    </div>
  );
}

// ── Screen 1: Default Editor Layout ──────────────────────────
function Screen1Default() {
  const [tab, setTab] = React.useState('inspector');
  const [bottom, setBottom] = React.useState('assets');
  return (
    <ScreenFrame label="01 Default Editor Layout">
      <EditorMenubar />
      <MainToolbar tool="select" transform="move" />
      <div className="workspace">
        <div className="ws-left"><WorldOutliner /></div>
        <div className="ws-center">
          <Panel title="Viewport" icon={Icons.Globe} testid="panel-viewport"
            hint={{ text: 'Hero canvas. Hold Alt+drag to orbit, Shift+drag to pan, scroll to zoom.' }}>
            <ViewportShell variant="default" tool="select" overlays={{ grid: true, chunks: true, selection: true }}
              contextStrip={<div className="row" style={{ gap: 4 }}>
                <span className="tag">Select</span>
                <VoxelPaletteStrip />
                <span className="muted" style={{ fontSize: 10 }}>·</span>
                <span className="num" style={{ fontSize: 10, color: 'var(--accent-strong)' }}>1 chunk</span>
              </div>}
            />
          </Panel>
        </div>
        <div className="ws-right">
          <Panel
            tabs={[
              { id: 'inspector', label: 'Inspector' },
              { id: 'brush', label: 'Brush' },
              { id: 'rules', label: 'Rules' },
              { id: 'material', label: 'Material' },
              { id: 'debug', label: 'Debug' },
            ]}
            activeTab={tab} onTab={setTab}
            hint={{ text: 'Properties of the current selection. Tabs follow the active tool.' }}
            testid="panel-inspector"
          >
            <InspectorVoxel />
          </Panel>
        </div>
        <div className="ws-bottom"><BottomDock defaultTab={bottom} /></div>
      </div>
      <StatusBar tool="select" selection="chunk [16,3,−4]" />
    </ScreenFrame>
  );
}

// ── Screen 2: Area / Unbreakable ─────────────────────────────
function Screen2Area() {
  return (
    <ScreenFrame label="02 Area / Unbreakable Zone">
      <EditorMenubar />
      <MainToolbar tool="area" transform="move" />
      <div className="workspace">
        <div className="ws-left"><WorldOutliner selectedId="story-locks" /></div>
        <div className="ws-center">
          <Panel title="Viewport · Area Mode" icon={Icons.Shield} testid="panel-viewport"
            hint={{ text: 'Drag to draw a volume. Click a chunk to add to the chunk-set shape.' }}>
            <ViewportShell variant="area" tool="area" overlays={{ grid: true, chunks: true, area: true }}
              contextStrip={<div className="row" style={{ gap: 4 }}>
                <span className="seg" style={{ height: 20 }}>
                  <button><span style={{ fontSize: 10 }}>Box</span></button>
                  <button><span style={{ fontSize: 10 }}>Sphere</span></button>
                  <button><span style={{ fontSize: 10 }}>Cyl</span></button>
                  <button className="active"><span style={{ fontSize: 10 }}>Chunks</span></button>
                </span>
                <span className="div" style={{ width: 1, height: 14, background: 'var(--border)' }} />
                <span className="tag bad">Unbreakable</span>
                <button className="btn sm pri"><Icons.Plus size={10} />Add Volume</button>
              </div>}
            />
          </Panel>
        </div>
        <div className="ws-right">
          <Panel
            tabs={[{id:'inspector',label:'Inspector'},{id:'rules',label:'Rules'},{id:'audit',label:'Audit'}]}
            activeTab="inspector"
            hint={{ text: 'Defines who/what can change voxels inside this volume. Higher priority wins.' }}
            testid="panel-inspector">
            <InspectorArea />
          </Panel>
        </div>
        <div className="ws-bottom"><BottomDock defaultTab="console" /></div>
      </div>
      <StatusBar tool="area" selection="Story Lock — Ember Sanctum (3 chunks)" />
    </ScreenFrame>
  );
}

// ── Screen 3: Voxel Paint + Texture Atlas ────────────────────
function Screen3Paint() {
  return (
    <ScreenFrame label="03 Voxel Paint + Texture Atlas">
      <EditorMenubar />
      <MainToolbar tool="paint" transform="move" />
      <div className="workspace">
        <div className="ws-left"><WorldOutliner selectedId="chunk-16-3-4" /></div>
        <div className="ws-center">
          <Panel title="Viewport · Paint Mode" icon={Icons.Paint} testid="panel-viewport"
            hint={{ text: 'Click voxels to apply the selected block + atlas. Hold ⇧ to paint sides only.' }}>
            <ViewportShell variant="paint" tool="paint" overlays={{ grid: true, brush: true }}
              contextStrip={<div className="row" style={{ gap: 4 }}>
                <span className="tag cyan">Paint</span>
                <VoxelPaletteStrip />
                <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
                <span className="seg" style={{ height: 20 }}>
                  <button className="active"><span style={{ fontSize: 10 }}>Top</span></button>
                  <button><span style={{ fontSize: 10 }}>Side</span></button>
                  <button><span style={{ fontSize: 10 }}>Bottom</span></button>
                  <button><span style={{ fontSize: 10 }}>All</span></button>
                </span>
                <span className="num muted" style={{ fontSize: 10 }}>r 12</span>
                <span className="num muted" style={{ fontSize: 10 }}>str 0.65</span>
              </div>}
            />
          </Panel>
        </div>
        <div className="ws-right">
          <Panel
            tabs={[{id:'brush',label:'Brush'},{id:'material',label:'Material'},{id:'inspector',label:'Inspector'}]}
            activeTab="brush"
            hint={{ text: 'Brush, palette, and per-face atlas tile assignment.' }}
            testid="panel-inspector">
            <div className="insp">
              <InspSection title="Brush">
                <Row label="Shape"><Sel value="Sphere" options={['Sphere','Cube','Cylinder','Plane']} /></Row>
                <Row label="Radius"><Slider value={0.4} fmt={(v)=>Math.round(v*30)} /></Row>
                <Row label="Strength"><Slider value={0.65} /></Row>
                <Row label="Falloff"><Slider value={0.5} /></Row>
                <Row label="Snap"><Toggle on /></Row>
                <Row label="Replace only"><Chk on /></Row>
              </InspSection>
              <InspSection title="Selected Block">
                <Row label="Block"><div className="row"><div className="swatch" style={{ background: '#5a8c3a' }} /><span>Grass Block</span></div></Row>
                <Row label="Top atlas"><span className="num">tile_07</span></Row>
                <Row label="Side atlas"><span className="num">tile_18</span></Row>
                <Row label="Bottom atlas"><span className="num">tile_18</span></Row>
                <Row label="Replace existing"><Toggle on /></Row>
              </InspSection>
              <InspSection title="Paint Targets">
                {[['Top faces',true],['Side faces',false],['Bottom faces',false],['Across LODs',true]].map(([k,v]) => (
                  <div key={k} className="row" style={{ padding: '2px 0' }}><Chk on={v} label={k} /></div>
                ))}
              </InspSection>
            </div>
          </Panel>
        </div>
        <div className="ws-bottom">
          <Panel tabs={[
            {id:'atlas',label:'Texture Atlas'},
            {id:'assets',label:'Assets'},
            {id:'console',label:'Console'},
          ]} activeTab="atlas" testid="panel-bottom"
          hint={{ text: 'Atlas tile picker · 8×8 grid · drag a tile onto Top/Side/Bottom slot.' }}>
            <TextureAtlas />
          </Panel>
        </div>
      </div>
      <StatusBar tool="paint" selection="Grass Block · top tile_07" />
    </ScreenFrame>
  );
}

// ── Screen 4: Water Body Editor ──────────────────────────────
function Screen4Water() {
  return (
    <ScreenFrame label="04 Water Body Editor">
      <EditorMenubar />
      <MainToolbar tool="water" transform="move" />
      <div className="workspace">
        <div className="ws-left"><WorldOutliner selectedId="lake-03" /></div>
        <div className="ws-center">
          <Panel title="Viewport · Water Mode" icon={Icons.Water} testid="panel-viewport"
            hint={{ text: 'Drag along shore to extend. Right-click a body to set kind (Ocean/Lake/River/Pond).' }}>
            <ViewportShell variant="water" tool="water" overlays={{ grid: false, water: true }}
              contextStrip={<div className="row" style={{ gap: 4 }}>
                <span className="seg" style={{ height: 20 }}>
                  <button><span style={{ fontSize: 10 }}>Ocean</span></button>
                  <button className="active"><span style={{ fontSize: 10 }}>Lake</span></button>
                  <button><span style={{ fontSize: 10 }}>River</span></button>
                  <button><span style={{ fontSize: 10 }}>Pond</span></button>
                </span>
                <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
                <span className="tag cyan">LK_03</span>
                <button className="btn sm"><Icons.Beaker size={10} />Visual probe</button>
              </div>}
            />
          </Panel>
        </div>
        <div className="ws-right">
          <Panel
            tabs={[{id:'inspector',label:'Inspector'},{id:'foam',label:'Foam'},{id:'debug',label:'Debug'}]}
            activeTab="inspector"
            hint={{ text: 'Lake LK_03 — reflection, foam, fresnel. Toggle Debug for masks.' }}
            testid="panel-inspector">
            <InspectorWater />
          </Panel>
        </div>
        <div className="ws-bottom">
          <Panel tabs={[
            {id:'profiler',label:'Profiler'},
            {id:'console',label:'Console'},
            {id:'assets',label:'Assets'},
          ]} activeTab="profiler" testid="panel-bottom"
          hint={{ text: 'Live render timings. Watch the Water reflection pass while you edit.' }}>
            <ProfilerPanel />
          </Panel>
        </div>
      </div>
      <StatusBar tool="water" selection="Lake LK_03 — Mirror Pond" />
    </ScreenFrame>
  );
}

// ── Screen 5: Agent Workbench ────────────────────────────────
function Screen5Agent() {
  return (
    <ScreenFrame label="05 Agent Workbench" agent>
      <EditorMenubar agentMode />
      <MainToolbar tool="area" transform="move" agentMode />
      <div className="workspace" style={{ gridTemplateColumns: '244px 1fr 320px' }}>
        <div className="ws-left"><WorldOutliner selectedId="chunk-16-3-4" /></div>
        <div className="ws-center">
          <Panel title="Viewport · Agent Observing" icon={Icons.Bot} testid="panel-viewport"
            hint={{ agent: true, text: 'The agent is acting on this viewport. Hit Esc to interrupt and take over.' }}>
            <ViewportShell variant="agent" tool="area" agent overlays={{ grid: true, chunks: true }}
              contextStrip={<div className="row" style={{ gap: 4 }}>
                <span className="tag agent"><Icons.Bot size={9} />Step 3 / 6</span>
                <span style={{ color: 'var(--fg-2)', fontSize: 10 }}>Selecting chunks for unbreakable area</span>
                <button className="btn sm agent">Approve</button>
                <button className="btn sm">Pause</button>
              </div>}
            />
          </Panel>
        </div>
        <div className="ws-right"><AgentWorkbench /></div>
        <div className="ws-bottom">
          <Panel tabs={[
            {id:'agentlog',label:'Agent Log',badge:6},
            {id:'tests',label:'Tests',badge:5},
            {id:'console',label:'Console'},
          ]} activeTab="agentlog" testid="panel-bottom"
          hint={{ agent: true, text: 'Observe → Plan → Act → Verify timeline. All actions are auditable.' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', minHeight: 0 }}>
              <div style={{ borderRight: '1px solid var(--border-soft)', minHeight: 0, overflow: 'auto' }}><AgentLog /></div>
              <div style={{ minHeight: 0, overflow: 'auto' }}><TestsPanel /></div>
            </div>
          </Panel>
        </div>
      </div>
      <StatusBar tool="area" selection="3 chunks queued" agent="Plan 3/6 · acting" />
    </ScreenFrame>
  );
}

window.Screen1Default = Screen1Default;
window.Screen2Area = Screen2Area;
window.Screen3Paint = Screen3Paint;
window.Screen4Water = Screen4Water;
window.Screen5Agent = Screen5Agent;
