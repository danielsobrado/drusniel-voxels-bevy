// Shared editor chrome — Menubar, Toolbar, Statusbar, Panel, Tabs, etc.
// All components rely on global window.Icons.

const { useState, useMemo } = React;

// ── Menu bar ─────────────────────────────────────────────────
const MENUS = [
  'File','Edit','View','World','Voxels','Areas','Props','Materials','Water','Lighting','Agent','Debug','Window','Help'
];

function EditorMenubar({ activeMenu, onMenu, agentMode = false }) {
  return (
    <div className="menubar" data-testid="editor-menubar" role="menubar">
      <div className="brand"><span className="logo" /> Drusniel</div>
      {MENUS.map((m) => (
        <div
          key={m}
          className="menu"
          role="menuitem"
          data-testid={`menu-${m.toLowerCase()}`}
          onClick={() => onMenu && onMenu(m)}
          style={activeMenu === m ? { background: 'var(--bg-hover)', color: 'var(--fg)' } : null}
        >
          {m}
        </div>
      ))}
      <div className="spacer" />
      <div className="right">
        <span className="pill"><span className="mono">drusniel-world.dvw</span></span>
        <span className="pill"><Icons.Branch size={11} />&nbsp;main</span>
        {agentMode && <span className="pill agent"><Icons.Bot size={11} />&nbsp;Agent: ON</span>}
      </div>
    </div>
  );
}

// ── Status pill ─────────────────────────────────────────────
function StatusPill({ tone = 'default', children, mono = true, testid }) {
  const cls = `pill ${tone}`;
  return <span className={cls} data-testid={testid}><span className="dot" />{children}</span>;
}

// ── Top toolbar ─────────────────────────────────────────────
function MainToolbar({ tool, onTool, transform, onTransform, agentMode, onToggleAgent, onCmdK, fps = 142, frameMs = 7.0, dirty = 3 }) {
  const tools = [
    { id: 'select', label: 'Select', I: Icons.Cursor, k: 'Q' },
    { id: 'sculpt', label: 'Sculpt', I: Icons.Sculpt, k: 'W' },
    { id: 'paint', label: 'Paint', I: Icons.Paint, k: 'E' },
    { id: 'area', label: 'Area', I: Icons.AreaBox, k: 'R' },
    { id: 'props', label: 'Props', I: Icons.Tree, k: 'T' },
    { id: 'water', label: 'Water', I: Icons.Water, k: 'Y' },
    { id: 'build', label: 'Build', I: Icons.Build, k: 'U' },
    { id: 'measure', label: 'Measure', I: Icons.Ruler, k: 'I' },
  ];
  const tx = [
    { id: 'move', I: Icons.Move, label: 'Move' },
    { id: 'rotate', I: Icons.Rotate, label: 'Rotate' },
    { id: 'scale', I: Icons.Scale, label: 'Scale' },
  ];

  return (
    <div className="toolbar" data-testid="main-toolbar">
      <div className="grp">
        <button className="ibtn" title="Play (Space)" data-testid="toolbar-play"><Icons.Play size={13} /></button>
        <button className="ibtn" title="Pause"><Icons.Pause size={13} /></button>
        <button className="ibtn" title="Stop"><Icons.Square size={13} /></button>
      </div>
      <div className="div" />
      <div className="grp">
        <button className="ibtn" title="Save (⌘S)" data-testid="toolbar-save"><Icons.Save size={14} /></button>
        <button className="ibtn" title="Undo (⌘Z)"><Icons.Undo size={14} /></button>
        <button className="ibtn" title="Redo (⌘⇧Z)"><Icons.Redo size={14} /></button>
      </div>
      <div className="div" />
      <div className="seg" data-testid="tool-mode">
        {tools.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            onClick={() => onTool && onTool(t.id)}
            title={`${t.label} (${t.k})`}
            data-testid={`tool-${t.id}`}
          >
            <t.I size={13} />
            <span style={{ fontSize: 11 }}>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="div" />
      <div className="seg">
        {tx.map((t) => (
          <button
            key={t.id}
            className={transform === t.id ? 'active' : ''}
            onClick={() => onTransform && onTransform(t.id)}
            title={t.label}
          >
            <t.I size={12} />
          </button>
        ))}
      </div>
      <div className="div" />
      <div className="grp">
        <button className="ibtn" title="Grid snap"><Icons.Grid size={13} /></button>
        <button className="ibtn active" title="Voxel snap"><Icons.Cube size={13} /></button>
        <button className="ibtn" title="Angle snap"><Icons.Compass size={13} /></button>
      </div>
      <div className="div" />
      <div className="grp" style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>Brush</span>
        <span className="ddn"><Icons.Sculpt size={11} /> Sphere</span>
        <span className="ddn"><span className="num">12</span><span className="muted">r</span></span>
        <span className="ddn"><span className="num">0.65</span><span className="muted">str</span></span>
      </div>
      <div className="spacer" />
      <button className="btn ghost sm" onClick={onCmdK} data-testid="open-cmdk">
        <Icons.Search size={11} />Search… <span className="kbd">⌘</span><span className="kbd">K</span>
      </button>
      <span className="ddn" title="Quality preset"><Icons.Zap size={11} /> High</span>
      <div className="div" />
      <span className={`pill ${fps > 100 ? 'ok' : fps > 60 ? 'warn' : 'bad'}`}>
        <span className="dot" /> {fps.toFixed(0)} fps
      </span>
      <span className="pill"><span className="dot" />{frameMs.toFixed(1)} ms</span>
      <span className={`pill ${dirty > 0 ? 'warn' : 'ok'}`}>
        <span className="dot" />{dirty} dirty
      </span>
      <button
        className={`ibtn ${agentMode ? 'active' : ''}`}
        onClick={onToggleAgent}
        title="Agent Workbench"
        data-testid="toggle-agent"
        style={agentMode ? { background: 'var(--agent-soft)', color: 'var(--agent-strong)', borderColor: 'rgba(162,108,255,0.3)' } : null}
      >
        <Icons.Bot size={14} />
      </button>
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────
function Panel({ title, icon, tabs, activeTab, onTab, agent, hint, children, testid, options = true, dense, style }) {
  const Ico = icon;
  return (
    <div className="panel" data-testid={testid} style={style}>
      <div className="panel-tb">
        {Ico && <Ico size={12} style={{ color: 'var(--fg-3)' }} />}
        {title && <span className="title">{title}</span>}
        {tabs && (
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={t.id || t}
                className={`tab ${(activeTab || tabs[0].id || tabs[0]) === (t.id || t) ? 'active' : ''}`}
                onClick={() => onTab && onTab(t.id || t)}
                data-testid={`tab-${t.id || t}`.toLowerCase()}
              >
                {t.label || t}
                {t.badge != null && <span className="badge">{t.badge}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="spacer" />
        <div className="ctl-grp">
          {agent && <span className="tag agent" title="Agent-aware panel"><Icons.Bot size={9} />agent</span>}
          <button className="ibtn sm" title="Pin"><Icons.Pin size={11} /></button>
          <button className="ibtn sm" title="Panel options"><Icons.MoreV size={11} /></button>
          <button className="ibtn sm" title="Close"><Icons.X size={11} /></button>
        </div>
      </div>
      {hint && (
        <div className={`hint ${hint.agent ? 'agent' : ''}`}>
          {hint.agent ? <Icons.Bot size={11} /> : <Icons.Info size={11} className="ico" />}
          <span>{hint.text}</span>
        </div>
      )}
      <div className={`panel-body ${dense ? '' : ''}`}>
        {children}
      </div>
    </div>
  );
}

// ── Statusbar ───────────────────────────────────────────────
function StatusBar({ tool = 'sculpt', selection, agent }) {
  return (
    <div className="statusbar" data-testid="statusbar">
      <div className="sb-grp"><Icons.Cube size={11} /><span className="lbl">tool</span><span className="v">{tool}</span></div>
      <div className="sb-sep" />
      <div className="sb-grp"><span className="lbl">cam</span><span className="v">128.4 64.0 −96.7</span></div>
      <div className="sb-sep" />
      <div className="sb-grp"><span className="lbl">vox</span><span className="v">x:512 y:48 z:−128</span></div>
      <div className="sb-sep" />
      <div className="sb-grp"><span className="lbl">chunk</span><span className="v">[16, 3, −4]</span></div>
      <div className="sb-sep" />
      <div className="sb-grp"><span className="lbl">sel</span><span className="v">{selection || 'none'}</span></div>
      <div className="spacer" />
      {agent && <div className="sb-grp"><Icons.Bot size={11} style={{ color: 'var(--agent-strong)' }} /><span className="v" style={{ color: 'var(--agent-strong)' }}>{agent}</span></div>}
      <div className="sb-grp"><span className="lbl">mem</span><span className="v">2.1 GB</span></div>
      <div className="sb-sep" />
      <div className="sb-grp"><span className="lbl">build</span><span className="v">v0.4.2-rc1</span></div>
    </div>
  );
}

// ── Inspector primitives ────────────────────────────────────
function InspSection({ title, right, defaultOpen = true, children, testid }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="insp-section" data-testid={testid}>
      <div className="insp-h" onClick={() => setOpen(!open)}>
        <span className="chev">{open ? <Icons.ChevD size={10} /> : <Icons.ChevR size={10} />}</span>
        <span>{title}</span>
        <div className="right">{right}<Icons.MoreV size={11} /></div>
      </div>
      {open && <div className="insp-body">{children}</div>}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="insp-row">
      <div className="lbl">{label}</div>
      <div className="val">{children}</div>
    </div>
  );
}

function Vec3({ x = 0, y = 0, z = 0 }) {
  return (
    <div className="vec3" style={{ width: '100%' }}>
      <div className="axis x" data-axis="X"><input className="num-input" defaultValue={x} /></div>
      <div className="axis y" data-axis="Y"><input className="num-input" defaultValue={y} /></div>
      <div className="axis z" data-axis="Z"><input className="num-input" defaultValue={z} /></div>
    </div>
  );
}

function Slider({ value = 0.5, label, min = 0, max = 1, fmt }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider" style={{ width: '100%' }}>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
        <div className="thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="v">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <span
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange && onChange(!on)}
      role="switch"
      aria-checked={on}
    />
  );
}

function Chk({ on, label, onChange }) {
  return (
    <span
      onClick={() => onChange && onChange(!on)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'default' }}
    >
      <span className={`chk ${on ? 'on' : ''}`}>{on && <Icons.Check size={9} sw={2.5} />}</span>
      {label && <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{label}</span>}
    </span>
  );
}

function Sel({ value, options }) {
  return (
    <select className="select" defaultValue={value}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Tree row
function TreeItem({ depth = 0, icon, name, meta, badges, selected, expanded, hidden, locked, onClick, dirty }) {
  const Ico = icon;
  return (
    <div className={`tree-row ${selected ? 'selected' : ''}`} onClick={onClick} style={{ paddingLeft: 6 + depth * 12 }}>
      <span className="chev">{expanded === true ? <Icons.ChevD size={10} /> : expanded === false ? <Icons.ChevR size={10} /> : null}</span>
      {Ico && <span className="ico"><Ico size={12} /></span>}
      <span className="name">{name}</span>
      {dirty && <span className="badge dirty">dirty</span>}
      {badges}
      {meta != null && <span className="meta">{meta}</span>}
      <span className="actions">
        <button className="ibtn sm" title="Visibility">{hidden ? <Icons.EyeOff size={11} /> : <Icons.Eye size={11} />}</button>
        <button className="ibtn sm" title="Lock">{locked ? <Icons.Lock size={11} /> : <Icons.LockOpen size={11} />}</button>
      </span>
    </div>
  );
}

Object.assign(window, {
  EditorMenubar, MainToolbar, Panel, StatusBar, StatusPill,
  InspSection, Row, Vec3, Slider, Toggle, Chk, Sel, TreeItem,
});
