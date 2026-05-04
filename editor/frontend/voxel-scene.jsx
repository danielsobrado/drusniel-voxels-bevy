// Stylized SVG voxel island scene — used as the viewport "Bevy runtime" placeholder.
// Variants: 'default' | 'area' | 'paint' | 'water' | 'agent'

function VoxelScene({ variant = 'default', overlays = {} }) {
  const showGrid = overlays.grid !== false;
  const showChunks = overlays.chunks !== false;
  const showBrush = overlays.brush;
  const showArea = overlays.area;
  const showWater = overlays.water !== false;
  const showSelection = overlays.selection;
  const showAgent = overlays.agent;
  const showProps = overlays.props !== false;

  // Colors per voxel type
  const C = {
    grass: '#5a8c3a', grassL: '#76ad4d', grassD: '#3a6324',
    dirt:  '#8a5a3a', dirtL: '#a36c46', dirtD: '#5e3d27',
    stone: '#7a7e85', stoneL: '#9aa0a8', stoneD: '#52565d',
    sand:  '#d8c389', sandL: '#ebd8a3', sandD: '#a89465',
    water: '#1f5d8c', waterL: '#3a85b8',
    waterDeep: '#0e2f4a',
    snow: '#e6ecf2', snowD: '#bcc4cd',
  };

  // Build a heightfield 24x24
  const W = 24, H = 24;
  const heights = [];
  for (let z = 0; z < H; z++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const cx = (x - W/2) / 8, cz = (z - H/2) / 8;
      const r = Math.sqrt(cx*cx + cz*cz);
      const n = Math.sin(x*0.7 + z*0.4) * 0.3 + Math.cos(x*0.3 - z*0.6) * 0.4;
      let h = 4 - r*2.5 + n;
      h = Math.max(0, Math.round(h));
      row.push(h);
    }
    heights.push(row);
  }

  // isometric projection
  const TS = 22; // tile size
  const TH = 11; // height step
  const ox = 480, oy = 200;
  const iso = (x, y, z) => ({
    sx: ox + (x - z) * TS,
    sy: oy + (x + z) * (TS/2) - y * TH,
  });

  // Generate cubes back-to-front
  const cubes = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const h = heights[z][x];
      if (h === 0) continue;
      // Top voxel type
      let top, side, bot;
      if (h <= 1) { top = C.sand; side = C.sandD; bot = C.sandD; }
      else if (h >= 6) { top = C.snow; side = C.stoneL; bot = C.stoneD; }
      else if (h >= 5) { top = C.stone; side = C.stoneD; bot = C.stoneD; }
      else { top = C.grass; side = C.dirt; bot = C.dirtD; }
      cubes.push({ x, y: h, z, top, side, bot });
    }
  }
  cubes.sort((a, b) => (a.x + a.z) - (b.x + b.z) || a.y - b.y);

  const cubeFaces = (c, opts = {}) => {
    const { sx, sy } = iso(c.x, c.y, c.z);
    const top = `M${sx},${sy} L${sx+TS},${sy+TS/2} L${sx},${sy+TS} L${sx-TS},${sy+TS/2} Z`;
    const right = `M${sx},${sy+TS} L${sx+TS},${sy+TS/2} L${sx+TS},${sy+TS/2+TH} L${sx},${sy+TS+TH} Z`;
    const left = `M${sx},${sy+TS} L${sx-TS},${sy+TS/2} L${sx-TS},${sy+TS/2+TH} L${sx},${sy+TS+TH} Z`;
    const stroke = opts.stroke || 'rgba(0,0,0,0.35)';
    const sw = opts.sw || 0.5;
    return (
      <g key={`c-${c.x}-${c.y}-${c.z}`}>
        <path d={top} fill={c.top} stroke={stroke} strokeWidth={sw} />
        <path d={right} fill={c.side} stroke={stroke} strokeWidth={sw} />
        <path d={left} fill={c.bot} stroke={stroke} strokeWidth={sw} />
      </g>
    );
  };

  // Water surface (fills cells where h <= 1 inside ring)
  const waterCells = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (heights[z][x] <= 1) {
        const dx = (x - W/2), dz = (z - H/2);
        const r = Math.sqrt(dx*dx + dz*dz);
        if (r < 14) waterCells.push({ x, z });
      }
    }
  }

  // selection chunk for variant 'default' / 'area'
  const chunkBounds = []; // 8x8 chunk lines
  if (showChunks) {
    for (let i = 0; i <= W; i += 8) {
      for (let z = 0; z <= H; z++) {
        // skipped — we'll draw chunk box overlays differently
      }
    }
  }

  // Selected chunk highlight (for default/area)
  const selChunk = { x: 8, z: 8, w: 8, d: 8 };
  const chunkOutline = (cx, cz, cw, cd, color) => {
    const a = iso(cx, 0, cz);
    const b = iso(cx + cw, 0, cz);
    const c = iso(cx + cw, 0, cz + cd);
    const d = iso(cx, 0, cz + cd);
    const yTop = -3.5;
    const a2 = { sx: a.sx, sy: a.sy + yTop * TH };
    const b2 = { sx: b.sx, sy: b.sy + yTop * TH };
    const c2 = { sx: c.sx, sy: c.sy + yTop * TH };
    const d2 = { sx: d.sx, sy: d.sy + yTop * TH };
    return (
      <g>
        <path d={`M${a.sx},${a.sy} L${b.sx},${b.sy} L${c.sx},${c.sy} L${d.sx},${d.sy} Z`} fill={`${color}22`} stroke={color} strokeWidth={1} strokeDasharray="3 2" />
        <path d={`M${a2.sx},${a2.sy} L${b2.sx},${b2.sy} L${c2.sx},${c2.sy} L${d2.sx},${d2.sy} Z`} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 2" />
        <line x1={a.sx} y1={a.sy} x2={a2.sx} y2={a2.sy} stroke={color} strokeWidth={1} strokeDasharray="2 2" />
        <line x1={b.sx} y1={b.sy} x2={b2.sx} y2={b2.sy} stroke={color} strokeWidth={1} strokeDasharray="2 2" />
        <line x1={c.sx} y1={c.sy} x2={c2.sx} y2={c2.sy} stroke={color} strokeWidth={1} strokeDasharray="2 2" />
        <line x1={d.sx} y1={d.sy} x2={d2.sx} y2={d2.sy} stroke={color} strokeWidth={1} strokeDasharray="2 2" />
      </g>
    );
  };

  // Brush sphere
  const brushPos = iso(13, 4, 11);

  // Props (trees/rocks)
  const props = [
    { type: 'tree', x: 6, z: 6 }, { type: 'tree', x: 7, z: 9 }, { type: 'tree', x: 14, z: 7 },
    { type: 'tree', x: 16, z: 12 }, { type: 'tree', x: 9, z: 14 }, { type: 'tree', x: 12, z: 16 },
    { type: 'rock', x: 5, z: 12 }, { type: 'rock', x: 17, z: 9 }, { type: 'rock', x: 11, z: 5 },
  ].filter(p => heights[p.z]?.[p.x] >= 2);

  return (
    <svg viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* Sky gradient */}
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2638" />
          <stop offset="60%" stopColor="#0f1620" />
          <stop offset="100%" stopColor="#0a0d12" />
        </linearGradient>
        <radialGradient id="sun" cx="78%" cy="22%" r="22%">
          <stop offset="0%" stopColor="#ffd28a" stopOpacity="0.7" />
          <stop offset="60%" stopColor="#ffd28a" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffd28a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a85b8" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0e2f4a" stopOpacity="0.95" />
        </linearGradient>
        <pattern id="waveLines" width="20" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 3 Q5 0 10 3 T20 3" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" fill="none" />
        </pattern>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      <rect width="960" height="540" fill="url(#sky)" />
      <rect width="960" height="540" fill="url(#sun)" />

      {/* Distant fog mountains */}
      <g opacity="0.5">
        <path d="M0 320 L80 270 L150 300 L240 240 L340 290 L430 250 L520 290 L620 240 L730 280 L840 250 L960 290 L960 360 L0 360 Z" fill="#1c2434" />
        <path d="M0 360 L120 320 L210 350 L320 300 L420 340 L530 310 L640 350 L740 320 L860 350 L960 330 L960 400 L0 400 Z" fill="#141a26" opacity="0.85" />
      </g>

      {/* Voxel chunk grid (faint) */}
      {showGrid && (
        <g opacity="0.18">
          {Array.from({ length: W + 1 }).map((_, i) => {
            const a = iso(i, 0, 0), b = iso(i, 0, H);
            return <line key={`gx-${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#5dd6ff" strokeWidth="0.4" />;
          })}
          {Array.from({ length: H + 1 }).map((_, i) => {
            const a = iso(0, 0, i), b = iso(W, 0, i);
            return <line key={`gz-${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#5dd6ff" strokeWidth="0.4" />;
          })}
        </g>
      )}

      {/* Water plane */}
      {showWater && (
        <g>
          {waterCells.map((w, i) => {
            const a = iso(w.x, 1, w.z);
            return (
              <path
                key={`w-${i}`}
                d={`M${a.sx},${a.sy} L${a.sx+TS},${a.sy+TS/2} L${a.sx},${a.sy+TS} L${a.sx-TS},${a.sy+TS/2} Z`}
                fill="url(#waterGrad)"
              />
            );
          })}
          {/* wave overlay */}
          {waterCells.map((w, i) => {
            const a = iso(w.x, 1, w.z);
            return (
              <path
                key={`wo-${i}`}
                d={`M${a.sx},${a.sy} L${a.sx+TS},${a.sy+TS/2} L${a.sx},${a.sy+TS} L${a.sx-TS},${a.sy+TS/2} Z`}
                fill="url(#waveLines)"
                opacity="0.7"
              />
            );
          })}
        </g>
      )}

      {/* Cubes */}
      <g>
        {cubes.map((c) => cubeFaces(c))}
      </g>

      {/* Props */}
      {showProps && (
        <g>
          {props.map((p, i) => {
            const h = heights[p.z][p.x];
            const a = iso(p.x, h, p.z);
            if (p.type === 'tree') {
              return (
                <g key={`p-${i}`}>
                  <rect x={a.sx-1.5} y={a.sy-14} width={3} height={14} fill="#5a3a22" />
                  <ellipse cx={a.sx} cy={a.sy-18} rx={9} ry={11} fill="#3e6e2c" stroke="#284a1c" strokeWidth="0.5" />
                  <ellipse cx={a.sx-3} cy={a.sy-22} rx={6} ry={7} fill="#4f8438" />
                </g>
              );
            }
            return (
              <g key={`p-${i}`}>
                <ellipse cx={a.sx} cy={a.sy} rx={7} ry={4} fill="#646871" stroke="#3a3e44" strokeWidth="0.5" />
                <path d={`M${a.sx-6},${a.sy} Q${a.sx},${a.sy-7} ${a.sx+6},${a.sy} Z`} fill="#7a8088" stroke="#3a3e44" strokeWidth="0.5" />
              </g>
            );
          })}
        </g>
      )}

      {/* Selected chunk (default) */}
      {showSelection && variant === 'default' && chunkOutline(selChunk.x, selChunk.z, selChunk.w, selChunk.d, '#4ec5ff')}

      {/* Selected chunk highlight pillars */}
      {showSelection && variant === 'default' && (
        <g>
          {[[10,9],[11,10],[12,9]].map(([x,z],i) => {
            const h = heights[z][x];
            const a = iso(x, h, z);
            const t = `M${a.sx},${a.sy} L${a.sx+TS},${a.sy+TS/2} L${a.sx},${a.sy+TS} L${a.sx-TS},${a.sy+TS/2} Z`;
            return <path key={`sel-${i}`} d={t} fill="none" stroke="#4ec5ff" strokeWidth="1.5" filter="url(#glow)" />;
          })}
        </g>
      )}

      {/* Protected area (variant=area) */}
      {variant === 'area' && (
        <g>
          {chunkOutline(7, 7, 6, 6, '#ef4f5e')}
          <g opacity="0.85">
            {Array.from({ length: 6 }).map((_, i) => {
              const a = iso(7, 0, 7+i), b = iso(13, 0, 7+i);
              return <line key={`hatch-${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#ef4f5e" strokeWidth="0.5" strokeDasharray="2 4" opacity="0.4" />;
            })}
          </g>
          {/* Lock badge */}
          <g transform={`translate(${iso(10, 5, 10).sx - 14}, ${iso(10, 5, 10).sy - 32})`}>
            <rect x="0" y="0" width="64" height="22" rx="4" fill="rgba(20,22,26,0.9)" stroke="#ef4f5e" strokeWidth="1" />
            <g transform="translate(6, 4)" stroke="#ef4f5e" fill="none" strokeWidth="1.4">
              <rect x="0" y="6" width="14" height="9" rx="1.5" />
              <path d="M3 6V4a4 4 0 0 1 8 0v2" />
            </g>
            <text x="24" y="15" fill="#ef4f5e" fontSize="10" fontFamily="JetBrains Mono" fontWeight="600">UNBREAKABLE</text>
          </g>
        </g>
      )}

      {/* Brush sphere (variant=paint or default brush) */}
      {(variant === 'paint' || showBrush) && (
        <g>
          <circle cx={brushPos.sx} cy={brushPos.sy + TS/2} r="42" fill="rgba(78,197,255,0.06)" stroke="#4ec5ff" strokeWidth="1.2" strokeDasharray="2 2" />
          <ellipse cx={brushPos.sx} cy={brushPos.sy + TS} rx="42" ry="20" fill="none" stroke="#4ec5ff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          <circle cx={brushPos.sx} cy={brushPos.sy + TS/2} r="3" fill="#4ec5ff" />
        </g>
      )}

      {/* Paint preview ghost (variant=paint) */}
      {variant === 'paint' && (
        <g opacity="0.55">
          {[[12,11],[13,11],[14,11],[12,12],[13,12],[14,12]].map(([x,z], i) => {
            const a = iso(x, heights[z]?.[x] || 0, z);
            return (
              <path key={`pp-${i}`}
                d={`M${a.sx},${a.sy} L${a.sx+TS},${a.sy+TS/2} L${a.sx},${a.sy+TS} L${a.sx-TS},${a.sy+TS/2} Z`}
                fill="#36c46a" stroke="#36c46a" strokeWidth="1" />
            );
          })}
        </g>
      )}

      {/* Water variant: highlight the lake */}
      {variant === 'water' && (
        <g>
          {chunkOutline(4, 4, 16, 16, '#4ec5ff')}
          <g transform={`translate(${iso(12, 2, 12).sx - 18}, ${iso(12, 2, 12).sy - 38})`}>
            <rect x="0" y="0" width="80" height="22" rx="4" fill="rgba(20,22,26,0.9)" stroke="#4ec5ff" strokeWidth="1" />
            <g transform="translate(6, 5)" stroke="#4ec5ff" fill="none" strokeWidth="1.4">
              <path d="M6 0 C2 5 0 8 0 11 a6 6 0 0 0 12 0c0-3-2-6-6-11z" />
            </g>
            <text x="22" y="15" fill="#4ec5ff" fontSize="10" fontFamily="JetBrains Mono" fontWeight="600">LAKE · LK_03</text>
          </g>
        </g>
      )}

      {/* Agent variant: violet AI selection */}
      {variant === 'agent' && (
        <g>
          {chunkOutline(11, 11, 5, 5, '#b787ff')}
          {[[12,12],[13,12],[14,12],[12,13],[13,13]].map(([x,z], i) => {
            const a = iso(x, heights[z]?.[x] || 0, z);
            return (
              <path key={`ag-${i}`}
                d={`M${a.sx},${a.sy} L${a.sx+TS},${a.sy+TS/2} L${a.sx},${a.sy+TS} L${a.sx-TS},${a.sy+TS/2} Z`}
                fill="none" stroke="#b787ff" strokeWidth="1.5" filter="url(#glow)" />
            );
          })}
          <g transform={`translate(${iso(13, 4, 12).sx - 22}, ${iso(13, 4, 12).sy - 60})`}>
            <rect x="0" y="0" width="92" height="22" rx="4" fill="rgba(20,22,26,0.9)" stroke="#b787ff" strokeWidth="1" />
            <text x="8" y="15" fill="#b787ff" fontSize="10" fontFamily="JetBrains Mono" fontWeight="600">AGENT TARGET · 5</text>
          </g>
        </g>
      )}

      {/* fog tint at distance */}
      <rect width="960" height="540" fill="url(#sky)" opacity="0.15" />
    </svg>
  );
}

window.VoxelScene = VoxelScene;
